package com.example.shuttle.service;

import com.example.shuttle.model.RouteInfo;
import com.example.shuttle.model.VehicleLocation;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.util.List;

@Service
public class VehicleLocationService {
    private final JdbcTemplate jdbcTemplate;
    private final RouteService routeService;

    public VehicleLocationService(JdbcTemplate jdbcTemplate, RouteService routeService) {
        this.jdbcTemplate = jdbcTemplate;
        this.routeService = routeService;
    }

    public VehicleLocation startTrip(String vehicleId, String driverName, String routeId) {
        upsertRuntime(vehicleId, routeId, driverName, null, null, null, "RUNNING");
        return getByVehicleId(vehicleId);
    }

    public VehicleLocation stopTrip(String vehicleId) {
        VehicleLocation current = getByVehicleId(vehicleId);
        if (current == null) {
            return null;
        }
        current.setStatus("STOPPED");
        current.setUpdateTime(LocalDateTime.now());
        deleteRuntime(vehicleId);
        return current;
    }

    public VehicleLocation updateLocation(String vehicleId, String driverName, String routeId, Double latitude, Double longitude, Double speed) {
        VehicleLocation vehicleLocation = new VehicleLocation();
        fillBasicFields(vehicleLocation, vehicleId, driverName, routeId);
        vehicleLocation.setLatitude(latitude);
        vehicleLocation.setLongitude(longitude);
        vehicleLocation.setSpeed(speed);
        vehicleLocation.setStatus("RUNNING");
        vehicleLocation.setUpdateTime(LocalDateTime.now());

        upsertRuntime(
                vehicleId,
                routeId,
                driverName,
                latitude,
                longitude,
                speed,
                vehicleLocation.getStatus()
        );
        insertHistory(vehicleId, routeId, latitude, longitude, speed);
        return getByVehicleId(vehicleId);
    }

    public VehicleLocation getByVehicleId(String vehicleId) {
        String sql = baseSelect() + " WHERE vr.vehicle_id = ? LIMIT 1";
        List<VehicleLocation> list = jdbcTemplate.query(sql, this::mapVehicle, vehicleId);
        return list.isEmpty() ? null : list.get(0);
    }

    public List<VehicleLocation> getAll() {
        String sql = baseSelect() + " ORDER BY vr.vehicle_id";
        return jdbcTemplate.query(sql, this::mapVehicle);
    }

    public List<VehicleLocation> getByRouteId(String routeId) {
        if (routeId == null || routeId.isBlank()) {
            return getAll();
        }
        String sql = baseSelect() + " WHERE vr.route_id = ? ORDER BY vr.vehicle_id";
        return jdbcTemplate.query(sql, this::mapVehicle, routeId);
    }

    private String baseSelect() {
        return """
                SELECT vr.vehicle_id, vr.driver_name, vr.route_id, ri.route_name,
                       vr.latitude, vr.longitude, vr.speed, vr.status, vr.updated_at
                FROM vehicle_runtime vr
                LEFT JOIN route_info ri ON vr.route_id = ri.route_id
                """;
    }

    private VehicleLocation mapVehicle(ResultSet rs, int rowNum) throws SQLException {
        VehicleLocation vehicle = new VehicleLocation();
        vehicle.setVehicleId(rs.getString("vehicle_id"));
        vehicle.setDriverName(rs.getString("driver_name"));
        vehicle.setRouteId(rs.getString("route_id"));
        vehicle.setRouteName(rs.getString("route_name"));
        vehicle.setLatitude(getNullableDouble(rs, "latitude"));
        vehicle.setLongitude(getNullableDouble(rs, "longitude"));
        vehicle.setSpeed(getNullableDouble(rs, "speed"));
        vehicle.setStatus(rs.getString("status"));
        if (rs.getTimestamp("updated_at") != null) {
            vehicle.setUpdateTime(rs.getTimestamp("updated_at").toLocalDateTime());
        }
        return vehicle;
    }

    private Double getNullableDouble(ResultSet rs, String column) throws SQLException {
        double value = rs.getDouble(column);
        return rs.wasNull() ? null : value;
    }

    private void upsertRuntime(String vehicleId, String routeId, String driverName,
                               Double latitude, Double longitude, Double speed,
                               String status) {
        String sql = """
                INSERT INTO vehicle_runtime(
                    vehicle_id, route_id, driver_name, latitude, longitude, speed, status, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    route_id = VALUES(route_id),
                    driver_name = VALUES(driver_name),
                    latitude = VALUES(latitude),
                    longitude = VALUES(longitude),
                    speed = VALUES(speed),
                    status = VALUES(status),
                    updated_at = NOW()
                """;
        jdbcTemplate.update(sql, vehicleId, routeId, driverName, latitude, longitude, speed, status);
    }

    private void insertHistory(String vehicleId, String routeId, Double latitude, Double longitude, Double speed) {
        if (latitude == null || longitude == null) {
            return;
        }
        String sql = """
                INSERT INTO vehicle_location_history(vehicle_id, route_id, latitude, longitude, speed, report_time)
                VALUES (?, ?, ?, ?, ?, NOW())
                """;
        jdbcTemplate.update(sql, vehicleId, routeId, latitude, longitude, speed);
    }

    private void deleteRuntime(String vehicleId) {
        jdbcTemplate.update("DELETE FROM vehicle_runtime WHERE vehicle_id = ?", vehicleId);
    }

    private void fillBasicFields(VehicleLocation vehicleLocation, String vehicleId, String driverName, String routeId) {
        vehicleLocation.setVehicleId(vehicleId);
        vehicleLocation.setDriverName(driverName);
        vehicleLocation.setRouteId(routeId);
        RouteInfo route = routeService.getRoute(routeId);
        vehicleLocation.setRouteName(route == null ? "未分配线路" : route.getRouteName());
    }

}
