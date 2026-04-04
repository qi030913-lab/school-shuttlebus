package com.example.shuttle.service;

import com.example.shuttle.model.RouteInfo;
import com.example.shuttle.model.StationInfo;
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
        RouteInfo route = routeService.getRoute(routeId);
        upsertRuntime(vehicleId, routeId, driverName, null, null, null, "RUNNING", null, null, null);
        return getByVehicleId(vehicleId);
    }

    public VehicleLocation stopTrip(String vehicleId) {
        VehicleLocation current = getByVehicleId(vehicleId);
        if (current == null) {
            return null;
        }
        upsertRuntime(vehicleId, current.getRouteId(), current.getDriverName(), current.getLatitude(), current.getLongitude(), current.getSpeed(),
                "STOPPED", current.getNearestStationName(), current.getDistanceToNearestStationMeters(), 0);
        return getByVehicleId(vehicleId);
    }

    public VehicleLocation updateLocation(String vehicleId, String driverName, String routeId, Double latitude, Double longitude, Double speed) {
        VehicleLocation vehicleLocation = new VehicleLocation();
        fillBasicFields(vehicleLocation, vehicleId, driverName, routeId);
        vehicleLocation.setLatitude(latitude);
        vehicleLocation.setLongitude(longitude);
        vehicleLocation.setSpeed(speed);
        vehicleLocation.setStatus("RUNNING");
        fillRouteRuntimeFields(vehicleLocation);
        vehicleLocation.setUpdateTime(LocalDateTime.now());

        upsertRuntime(
                vehicleId,
                routeId,
                driverName,
                latitude,
                longitude,
                speed,
                vehicleLocation.getStatus(),
                vehicleLocation.getNearestStationName(),
                vehicleLocation.getDistanceToNearestStationMeters(),
                vehicleLocation.getEtaMinutes()
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
                       vr.latitude, vr.longitude, vr.speed, vr.status,
                       vr.nearest_station_name, vr.distance_to_station_meters, vr.eta_minutes, vr.updated_at
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
        vehicle.setNearestStationName(rs.getString("nearest_station_name"));
        vehicle.setDistanceToNearestStationMeters(getNullableDouble(rs, "distance_to_station_meters"));
        Integer eta = rs.getInt("eta_minutes");
        vehicle.setEtaMinutes(rs.wasNull() ? null : eta);
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
                               String status, String nearestStationName,
                               Double distanceToNearestStationMeters, Integer etaMinutes) {
        String sql = """
                INSERT INTO vehicle_runtime(
                    vehicle_id, route_id, driver_name, latitude, longitude, speed, status,
                    nearest_station_name, distance_to_station_meters, eta_minutes, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    route_id = VALUES(route_id),
                    driver_name = VALUES(driver_name),
                    latitude = VALUES(latitude),
                    longitude = VALUES(longitude),
                    speed = VALUES(speed),
                    status = VALUES(status),
                    nearest_station_name = VALUES(nearest_station_name),
                    distance_to_station_meters = VALUES(distance_to_station_meters),
                    eta_minutes = VALUES(eta_minutes),
                    updated_at = NOW()
                """;
        jdbcTemplate.update(sql, vehicleId, routeId, driverName, latitude, longitude, speed, status,
                nearestStationName, distanceToNearestStationMeters, etaMinutes);
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

    private void fillBasicFields(VehicleLocation vehicleLocation, String vehicleId, String driverName, String routeId) {
        vehicleLocation.setVehicleId(vehicleId);
        vehicleLocation.setDriverName(driverName);
        vehicleLocation.setRouteId(routeId);
        RouteInfo route = routeService.getRoute(routeId);
        vehicleLocation.setRouteName(route == null ? "未分配线路" : route.getRouteName());
    }

    private void fillRouteRuntimeFields(VehicleLocation vehicleLocation) {
        List<StationInfo> stations = routeService.getStations(vehicleLocation.getRouteId());
        if (stations.isEmpty() || vehicleLocation.getLatitude() == null || vehicleLocation.getLongitude() == null) {
            vehicleLocation.setNearestStationName(null);
            vehicleLocation.setDistanceToNearestStationMeters(null);
            vehicleLocation.setEtaMinutes(null);
            return;
        }

        StationInfo nearest = null;
        double minDistance = Double.MAX_VALUE;
        for (StationInfo station : stations) {
            double distance = distanceMeters(vehicleLocation.getLatitude(), vehicleLocation.getLongitude(), station.getLatitude(), station.getLongitude());
            if (distance < minDistance) {
                minDistance = distance;
                nearest = station;
            }
        }

        vehicleLocation.setNearestStationName(nearest == null ? null : nearest.getStationName());
        vehicleLocation.setDistanceToNearestStationMeters(Math.round(minDistance * 10.0) / 10.0);

        double speedMps = vehicleLocation.getSpeed() == null || vehicleLocation.getSpeed() <= 0 ? 4.5 : vehicleLocation.getSpeed();
        int etaMinutes = (int) Math.max(1, Math.ceil(minDistance / speedMps / 60.0));
        if ("STOPPED".equals(vehicleLocation.getStatus())) {
            etaMinutes = 0;
        }
        vehicleLocation.setEtaMinutes(etaMinutes);
    }

    private double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double earthRadius = 6371000;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return earthRadius * c;
    }
}
