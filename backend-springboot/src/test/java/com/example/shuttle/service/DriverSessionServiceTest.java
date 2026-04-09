package com.example.shuttle.service;

import com.example.shuttle.config.WechatMiniAppProperties;
import com.example.shuttle.model.DriverSession;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DriverSessionServiceTest {

    @Mock
    private JdbcTemplate jdbcTemplate;

    private DriverSessionService service;

    @BeforeEach
    void setUp() {
        WechatMiniAppProperties properties = new WechatMiniAppProperties();
        properties.setSessionExpireDays(7);
        service = new DriverSessionService(jdbcTemplate, properties);
    }

    @Test
    void createOrRefreshUpdatesExistingSessionWithNewToken() {
        String openId = "openid-1";
        String vehicleId = "BUS-01";
        AtomicReference<String> issuedToken = new AtomicReference<>();

        when(jdbcTemplate.update(
                contains("UPDATE driver_login_session"),
                anyString(),
                eq(vehicleId),
                any(LocalDateTime.class),
                eq(openId)
        )).thenAnswer(invocation -> {
            issuedToken.set(invocation.getArgument(1, String.class));
            return 1;
        });
        when(jdbcTemplate.query(anyString(), rowMapper(), eq(openId))).thenAnswer(invocation ->
                List.of(session(issuedToken.get(), openId, vehicleId))
        );

        DriverSession result = service.createOrRefresh(openId, vehicleId);

        assertFreshToken(result.getLoginToken());
        assertEquals(issuedToken.get(), result.getLoginToken());
    }

    @Test
    void createOrRefreshInsertsSessionWhenNoneExists() {
        String openId = "openid-2";
        String vehicleId = "BUS-02";
        AtomicReference<String> issuedToken = new AtomicReference<>();

        when(jdbcTemplate.update(
                contains("UPDATE driver_login_session"),
                anyString(),
                eq(vehicleId),
                any(LocalDateTime.class),
                eq(openId)
        )).thenReturn(0);
        when(jdbcTemplate.update(
                contains("INSERT INTO driver_login_session"),
                anyString(),
                eq(openId),
                eq(vehicleId),
                any(LocalDateTime.class)
        )).thenAnswer(invocation -> {
            issuedToken.set(invocation.getArgument(1, String.class));
            return 1;
        });
        when(jdbcTemplate.query(anyString(), rowMapper(), eq(openId))).thenAnswer(invocation ->
                List.of(session(issuedToken.get(), openId, vehicleId))
        );

        DriverSession result = service.createOrRefresh(openId, vehicleId);

        assertFreshToken(result.getLoginToken());
        assertEquals(issuedToken.get(), result.getLoginToken());
        verify(jdbcTemplate).update(
                contains("INSERT INTO driver_login_session"),
                anyString(),
                eq(openId),
                eq(vehicleId),
                any(LocalDateTime.class)
        );
    }

    @Test
    void createOrRefreshRetriesUpdateWhenConcurrentInsertOccurs() {
        String openId = "openid-3";
        String vehicleId = "BUS-03";
        AtomicReference<String> latestToken = new AtomicReference<>();
        AtomicInteger updateCalls = new AtomicInteger();

        when(jdbcTemplate.update(
                contains("UPDATE driver_login_session"),
                anyString(),
                eq(vehicleId),
                any(LocalDateTime.class),
                eq(openId)
        )).thenAnswer(invocation -> {
            latestToken.set(invocation.getArgument(1, String.class));
            return updateCalls.getAndIncrement() == 0 ? 0 : 1;
        });
        when(jdbcTemplate.update(
                contains("INSERT INTO driver_login_session"),
                anyString(),
                eq(openId),
                eq(vehicleId),
                any(LocalDateTime.class)
        )).thenThrow(new DuplicateKeyException("duplicate"));
        when(jdbcTemplate.query(anyString(), rowMapper(), eq(openId))).thenAnswer(invocation ->
                List.of(session(latestToken.get(), openId, vehicleId))
        );

        DriverSession result = service.createOrRefresh(openId, vehicleId);

        assertFreshToken(result.getLoginToken());
        assertEquals(2, updateCalls.get());
        assertEquals(latestToken.get(), result.getLoginToken());
    }

    @SuppressWarnings("unchecked")
    private RowMapper<DriverSession> rowMapper() {
        return (RowMapper<DriverSession>) org.mockito.ArgumentMatchers.any(RowMapper.class);
    }

    private DriverSession session(String token, String openId, String vehicleId) {
        DriverSession session = new DriverSession();
        session.setLoginToken(token);
        session.setOpenId(openId);
        session.setVehicleId(vehicleId);
        session.setExpireAt(LocalDateTime.now().plusDays(7));
        return session;
    }

    private void assertFreshToken(String token) {
        assertNotNull(token);
        assertEquals(32, token.length());
        assertTrue(token.matches("[0-9a-f]+"));
    }
}
