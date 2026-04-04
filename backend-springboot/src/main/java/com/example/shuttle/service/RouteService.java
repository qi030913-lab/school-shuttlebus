package com.example.shuttle.service;

import com.example.shuttle.model.RouteInfo;
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
        return jdbcTemplate.query(sql, this::mapRoute);
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
        return list.get(0);
    }

    private RouteInfo mapRoute(ResultSet rs, int rowNum) throws SQLException {
        RouteInfo route = new RouteInfo();
        route.setRouteId(rs.getString("route_id"));
        route.setRouteName(rs.getString("route_name"));
        route.setServiceTime(rs.getString("service_time"));
        return route;
    }

}
