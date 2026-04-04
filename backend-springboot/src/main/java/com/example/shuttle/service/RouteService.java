package com.example.shuttle.service;

import com.example.shuttle.model.RouteInfo;
import com.example.shuttle.model.StationInfo;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

@Service
public class RouteService {
    private final JdbcTemplate jdbcTemplate;

    public RouteService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<RouteInfo> getRoutes() {
        String sql = """
                SELECT route_id, route_name, service_time
                FROM route_info
                ORDER BY route_id
                """;
        List<RouteInfo> routes = jdbcTemplate.query(sql, this::mapRoute);
        for (RouteInfo route : routes) {
            route.setStations(getStations(route.getRouteId()));
        }
        return routes;
    }

    public RouteInfo getRoute(String routeId) {
        String sql = """
                SELECT route_id, route_name, service_time
                FROM route_info
                WHERE route_id = ?
                LIMIT 1
                """;
        List<RouteInfo> list = jdbcTemplate.query(sql, this::mapRoute, routeId);
        if (list.isEmpty()) {
            return null;
        }
        RouteInfo route = list.get(0);
        route.setStations(getStations(routeId));
        return route;
    }

    public List<StationInfo> getStations(String routeId) {
        String sql = """
                SELECT station_id, route_id, station_name, sequence_no, latitude, longitude
                FROM station_info
                WHERE route_id = ?
                ORDER BY sequence_no
                """;
        return jdbcTemplate.query(sql, this::mapStation, routeId);
    }

    private RouteInfo mapRoute(ResultSet rs, int rowNum) throws SQLException {
        RouteInfo route = new RouteInfo();
        route.setRouteId(rs.getString("route_id"));
        route.setRouteName(rs.getString("route_name"));
        route.setServiceTime(rs.getString("service_time"));
        return route;
    }

    private StationInfo mapStation(ResultSet rs, int rowNum) throws SQLException {
        StationInfo station = new StationInfo();
        station.setStationId(rs.getString("station_id"));
        station.setRouteId(rs.getString("route_id"));
        station.setStationName(rs.getString("station_name"));
        station.setSequenceNo(rs.getInt("sequence_no"));
        station.setLatitude(rs.getDouble("latitude"));
        station.setLongitude(rs.getDouble("longitude"));
        return station;
    }
}
