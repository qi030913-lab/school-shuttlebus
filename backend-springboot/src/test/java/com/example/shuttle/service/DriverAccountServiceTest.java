package com.example.shuttle.service;

import com.example.shuttle.exception.DriverAccountConflictException;
import com.example.shuttle.model.DriverAccount;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DriverAccountServiceTest {

    @Mock
    private JdbcTemplate jdbcTemplate;

    private DriverAccountService service;

    @BeforeEach
    void setUp() {
        service = new DriverAccountService(jdbcTemplate);
    }

    @Test
    void bindOrRegisterByOpenIdThrowsWhenVehicleBelongsToAnotherOpenId() {
        String openId = "openid-new";
        String vehicleId = "BUS-01";

        mockOpenIdQuery(openId, List.of());
        mockVehicleQuery(vehicleId, List.of(account("openid-old", "Old Driver", vehicleId, "R1")));

        assertThrows(DriverAccountConflictException.class,
                () -> service.bindOrRegisterByOpenId(openId, "New Driver", vehicleId, "R2"));
    }

    @Test
    void bindOrRegisterByOpenIdInsertsNewAccountWhenBindingDoesNotExist() {
        String openId = "openid-1";
        String driverName = "Alice";
        String vehicleId = "BUS-01";
        String routeId = "R1";
        DriverAccount insertedAccount = account(openId, driverName, vehicleId, routeId);

        mockOpenIdQuery(openId, List.of(), List.of(insertedAccount));
        mockVehicleQuery(vehicleId, List.of());

        DriverAccount result = service.bindOrRegisterByOpenId(openId, driverName, vehicleId, routeId);

        assertEquals(openId, result.getOpenId());
        assertEquals(vehicleId, result.getVehicleId());
        verify(jdbcTemplate).update(
                contains("INSERT INTO driver_account"),
                eq(openId),
                eq(driverName),
                eq(vehicleId),
                eq(routeId)
        );
    }

    @Test
    void bindOrRegisterByOpenIdUpdatesExistingAccountForSameOpenId() {
        String openId = "openid-1";
        String driverName = "Alice Updated";
        String vehicleId = "BUS-02";
        String routeId = "R2";
        DriverAccount existingAccount = account(openId, "Alice", "BUS-01", "R1");
        DriverAccount updatedAccount = account(openId, driverName, vehicleId, routeId);

        mockOpenIdQuery(openId, List.of(existingAccount), List.of(updatedAccount));
        mockVehicleQuery(vehicleId, List.of());

        DriverAccount result = service.bindOrRegisterByOpenId(openId, driverName, vehicleId, routeId);

        assertEquals(driverName, result.getDriverName());
        assertEquals(vehicleId, result.getVehicleId());
        assertEquals(routeId, result.getRouteId());
        verify(jdbcTemplate).update(
                contains("UPDATE driver_account"),
                eq(driverName),
                eq(vehicleId),
                eq(routeId),
                eq(openId)
        );
    }

    @SafeVarargs
    private final void mockOpenIdQuery(String openId, List<DriverAccount>... results) {
        when(jdbcTemplate.query(anyString(), rowMapper(), eq(openId)))
                .thenReturn(results[0], Arrays.copyOfRange(results, 1, results.length));
    }

    @SafeVarargs
    private final void mockVehicleQuery(String vehicleId, List<DriverAccount>... results) {
        when(jdbcTemplate.query(anyString(), rowMapper(), eq(vehicleId)))
                .thenReturn(results[0], Arrays.copyOfRange(results, 1, results.length));
    }

    @SuppressWarnings("unchecked")
    private RowMapper<DriverAccount> rowMapper() {
        return (RowMapper<DriverAccount>) org.mockito.ArgumentMatchers.any(RowMapper.class);
    }

    private DriverAccount account(String openId, String driverName, String vehicleId, String routeId) {
        DriverAccount account = new DriverAccount();
        account.setOpenId(openId);
        account.setDriverName(driverName);
        account.setVehicleId(vehicleId);
        account.setRouteId(routeId);
        account.setEnabled(true);
        return account;
    }
}
