package com.example.shuttle.service;

import com.example.shuttle.config.WechatMiniAppProperties;
import com.example.shuttle.model.DriverSession;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

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

    public DriverSession createOrRefresh(String openId, String vehicleId) {
        clearExpiredSessions();
        DriverSession existing = findByOpenId(openId);
        String token = existing == null ? UUID.randomUUID().toString().replace("-", "") : existing.getLoginToken();
        LocalDateTime expireAt = LocalDateTime.now().plusDays(properties.getSessionExpireDays());
        String sql = """
                INSERT INTO driver_login_session(login_token, open_id, vehicle_id, expire_at)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                  open_id = VALUES(open_id),
                  vehicle_id = VALUES(vehicle_id),
                  expire_at = VALUES(expire_at),
                  updated_at = NOW()
                """;
        jdbcTemplate.update(sql, token, openId, vehicleId, expireAt);
        return findValidByToken(token);
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

    public void clearExpiredSessions() {
        jdbcTemplate.update("DELETE FROM driver_login_session WHERE expire_at <= NOW()");
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
}
