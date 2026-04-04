package com.example.shuttle.service;

import com.example.shuttle.model.DriverAccount;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

@Service
public class DriverAccountService {

    private final JdbcTemplate jdbcTemplate;

    public DriverAccountService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public DriverAccount bindOrRegisterByOpenId(String openId, String driverName, String vehicleId, String routeId) {
        String sql = """
                INSERT INTO driver_account(open_id, driver_name, phone, vehicle_id, route_id, enabled)
                VALUES (?, ?, NULL, ?, ?, 1)
                ON DUPLICATE KEY UPDATE
                  driver_name = VALUES(driver_name),
                  vehicle_id = VALUES(vehicle_id),
                  route_id = VALUES(route_id),
                  enabled = 1,
                  updated_at = NOW()
                """;
        jdbcTemplate.update(sql, openId, driverName, vehicleId, routeId);
        DriverAccount account = findByOpenId(openId);
        if (account != null) {
            return account;
        }
        return findByVehicleId(vehicleId);
    }

    public DriverAccount findByOpenId(String openId) {
        String sql = """
                SELECT open_id, driver_name, phone, vehicle_id, route_id, enabled
                FROM driver_account
                WHERE open_id = ?
                LIMIT 1
                """;
        List<DriverAccount> list = jdbcTemplate.query(sql, this::mapRow, openId);
        return list.isEmpty() ? null : list.get(0);
    }

    public DriverAccount findByVehicleId(String vehicleId) {
        String sql = """
                SELECT open_id, driver_name, phone, vehicle_id, route_id, enabled
                FROM driver_account
                WHERE vehicle_id = ?
                LIMIT 1
                """;
        List<DriverAccount> list = jdbcTemplate.query(sql, this::mapRow, vehicleId);
        return list.isEmpty() ? null : list.get(0);
    }

    private DriverAccount mapRow(ResultSet rs, int rowNum) throws SQLException {
        DriverAccount account = new DriverAccount();
        account.setOpenId(rs.getString("open_id"));
        account.setDriverName(rs.getString("driver_name"));
        account.setPhone(rs.getString("phone"));
        account.setVehicleId(rs.getString("vehicle_id"));
        account.setRouteId(rs.getString("route_id"));
        account.setEnabled(rs.getBoolean("enabled"));
        return account;
    }
}
