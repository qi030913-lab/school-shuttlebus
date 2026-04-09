package com.example.shuttle.controller;

import com.example.shuttle.model.RouteInfo;
import com.example.shuttle.model.VehicleLocation;
import com.example.shuttle.service.RouteService;
import com.example.shuttle.service.VehicleLocationService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(UserController.class)
class UserControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private VehicleLocationService vehicleLocationService;

    @MockBean
    private RouteService routeService;

    @Test
    void getRoutesReturnsRouteList() throws Exception {
        RouteInfo route = new RouteInfo();
        route.setRouteId("R1");
        route.setRouteName("route-one");
        route.setServiceTime("07:00-22:00");

        when(routeService.getRoutes()).thenReturn(List.of(route));

        mockMvc.perform(get("/api/common/routes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data[0].routeId").value("R1"))
                .andExpect(jsonPath("$.data[0].routeName").value("route-one"));
    }

    @Test
    void getAllVehiclesReturnsVehiclesForSpecifiedRoute() throws Exception {
        VehicleLocation location = new VehicleLocation();
        location.setVehicleId("BUS-01");
        location.setRouteId("R1");
        location.setStatus("RUNNING");

        when(vehicleLocationService.getByRouteId("R1")).thenReturn(List.of(location));

        mockMvc.perform(get("/api/user/vehicles").param("routeId", "R1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data[0].vehicleId").value("BUS-01"))
                .andExpect(jsonPath("$.data[0].routeId").value("R1"));
    }

    @Test
    void getVehicleReturnsVehicleDataWhenVehicleExists() throws Exception {
        VehicleLocation location = new VehicleLocation();
        location.setVehicleId("BUS-01");
        location.setDriverName("driver-a");
        location.setRouteId("R1");
        location.setRouteName("route-one");
        location.setStatus("RUNNING");

        when(vehicleLocationService.getByVehicleId("BUS-01")).thenReturn(location);

        mockMvc.perform(get("/api/user/vehicles/BUS-01"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.vehicleId").value("BUS-01"))
                .andExpect(jsonPath("$.data.driverName").value("driver-a"));
    }

    @Test
    void getVehicleReturnsNotFoundResponseWhenVehicleDoesNotExist() throws Exception {
        when(vehicleLocationService.getByVehicleId("BUS-99")).thenReturn(null);

        mockMvc.perform(get("/api/user/vehicles/BUS-99"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Vehicle not found"));
    }

    @Test
    void getOverviewReturnsRouteAndVehicleList() throws Exception {
        RouteInfo route = new RouteInfo();
        route.setRouteId("R1");
        route.setRouteName("route-one");
        route.setServiceTime("07:00-22:00");

        VehicleLocation location = new VehicleLocation();
        location.setVehicleId("BUS-01");
        location.setStatus("RUNNING");

        when(routeService.getRoute("R1")).thenReturn(route);
        when(vehicleLocationService.getByRouteId("R1")).thenReturn(List.of(location));

        mockMvc.perform(get("/api/user/overview").param("routeId", "R1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.route.routeId").value("R1"))
                .andExpect(jsonPath("$.data.route.routeName").value("route-one"))
                .andExpect(jsonPath("$.data.vehicles[0].vehicleId").value("BUS-01"));
    }
}
