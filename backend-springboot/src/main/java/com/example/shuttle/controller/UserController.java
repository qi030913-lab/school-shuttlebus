package com.example.shuttle.controller;

import com.example.shuttle.model.ApiResponse;
import com.example.shuttle.model.RouteInfo;
import com.example.shuttle.model.RouteOverview;
import com.example.shuttle.model.VehicleLocation;
import com.example.shuttle.service.RouteService;
import com.example.shuttle.service.VehicleLocationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class UserController {

    private final VehicleLocationService vehicleLocationService;
    private final RouteService routeService;

    public UserController(VehicleLocationService vehicleLocationService, RouteService routeService) {
        this.vehicleLocationService = vehicleLocationService;
        this.routeService = routeService;
    }

    @GetMapping("/common/routes")
    public ResponseEntity<ApiResponse<List<RouteInfo>>> getRoutes() {
        return ResponseEntity.ok(ApiResponse.ok(routeService.getRoutes()));
    }

    @GetMapping("/user/vehicles")
    public ResponseEntity<ApiResponse<List<VehicleLocation>>> getAllVehicles(@RequestParam(required = false) String routeId) {
        return ResponseEntity.ok(ApiResponse.ok(vehicleLocationService.getByRouteId(routeId)));
    }

    @GetMapping("/user/vehicles/{vehicleId}")
    public ResponseEntity<ApiResponse<VehicleLocation>> getVehicle(@PathVariable String vehicleId) {
        VehicleLocation location = vehicleLocationService.getByVehicleId(vehicleId);
        if (location == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(ApiResponse.ok(location));
    }

    @GetMapping("/user/overview")
    public ResponseEntity<ApiResponse<RouteOverview>> getOverview(@RequestParam String routeId) {
        RouteOverview overview = new RouteOverview();
        overview.setRoute(routeService.getRoute(routeId));
        overview.setVehicles(vehicleLocationService.getByRouteId(routeId));
        return ResponseEntity.ok(ApiResponse.ok(overview));
    }
}
