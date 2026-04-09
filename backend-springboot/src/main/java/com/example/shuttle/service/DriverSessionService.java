package com.example.shuttle.service;

import com.example.shuttle.config.WechatMiniAppProperties;
import com.example.shuttle.model.DriverSession;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Service
public class DriverSessionService {
    private final JdbcTemplate jdbcTemplate;
    private final WechatMiniAppProperties properties;

    public DriverSessionService(JdbcTemplate jdbcTemplate, WechatMiniAppProperties properties) {
        this.jdbcTemplate = jdbcTemplate;
        this.properties = properties;
    }

    @Transactional
    public DriverSession createOrRefresh(String openId, String vehicleId) {
        String token = generateLoginToken();
        LocalDateTime expireAt = LocalDateTime.now().plusDays(properties.getSessionExpireDays());

        int updated = updateSessionByOpenId(token, openId, vehicleId, expireAt);
        if (updated == 0) {
            try {
                insertSession(token, openId, vehicleId, expireAt);
            } catch (DuplicateKeyException ex) {
                updateSessionByOpenId(token, openId, vehicleId, expireAt);
            }
        }

        DriverSession session = findByOpenId(openId);
        if (session == null) {
            throw new IllegalStateException("Failed to create driver session");
        }
        return session;
    }

    public DriverSession findValidByToken(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        String sql = """
                SELECT login_token, open_id, vehicle_id, expire_at
                FROM driver_login_session
                WHERE login_token = ? AND expire_at > NOW()
                LIMIT 1
                """;
        List<DriverSession> list = jdbcTemplate.query(sql, this::mapRow, token);
        return list.isEmpty() ? null : list.get(0);
    }

    public DriverSession requireValidToken(String token) {
        DriverSession session = findValidByToken(token);
        if (session == null) {
            throw new IllegalStateException("登录态无效或已过期，请重新登录");
        }
        return session;
    }

    private DriverSession findByOpenId(String openId) {
        String sql = """
                SELECT login_token, open_id, vehicle_id, expire_at
                FROM driver_login_session
                WHERE open_id = ?
                LIMIT 1
                """;
        List<DriverSession> list = jdbcTemplate.query(sql, this::mapRow, openId);
        return list.isEmpty() ? null : list.get(0);
    }

    private DriverSession mapRow(ResultSet rs, int rowNum) throws SQLException {
        DriverSession session = new DriverSession();
        session.setLoginToken(rs.getString("login_token"));
        session.setOpenId(rs.getString("open_id"));
        session.setVehicleId(rs.getString("vehicle_id"));
        if (rs.getTimestamp("expire_at") != null) {
            session.setExpireAt(rs.getTimestamp("expire_at").toLocalDateTime());
        }
        return session;
    }

    private int updateSessionByOpenId(String token, String openId, String vehicleId, LocalDateTime expireAt) {
        String sql = """
                UPDATE driver_login_session
                SET login_token = ?, vehicle_id = ?, expire_at = ?, updated_at = NOW()
                WHERE open_id = ?
                """;
        return jdbcTemplate.update(sql, token, vehicleId, expireAt, openId);
    }

    private void insertSession(String token, String openId, String vehicleId, LocalDateTime expireAt) {
        String sql = """
                INSERT INTO driver_login_session(login_token, open_id, vehicle_id, expire_at)
                VALUES (?, ?, ?, ?)
                """;
        jdbcTemplate.update(sql, token, openId, vehicleId, expireAt);
    }

    private String generateLoginToken() {
        return UUID.randomUUID().toString().replace("-", "");
    }
}
