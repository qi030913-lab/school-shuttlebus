package com.example.shuttle.service;

import com.example.shuttle.exception.TripStateException;
import com.example.shuttle.model.RouteInfo;
import com.example.shuttle.model.VehicleLocation;
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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class VehicleLocationServiceTest {

    @Mock
    private JdbcTemplate jdbcTemplate;

    @Mock
    private RouteService routeService;

    private VehicleLocationService service;

    @BeforeEach
    void setUp() {
        service = new VehicleLocationService(jdbcTemplate, routeService);
    }

    @Test
    void startTripKeepsKnownLocationAndResetsSpeedToZeroWhenVehicleWasStopped() {
        String vehicleId = "BUS-01";
        VehicleLocation current = vehicle(vehicleId, "driver-a", "R1", 36.111111, 117.222222, 12.5, "STOPPED");
        VehicleLocation started = vehicle(vehicleId, "driver-a", "R1", 36.111111, 117.222222, 0.0, "RUNNING");

        mockVehicleQuery(vehicleId, List.of(current), List.of(started));

        VehicleLocation result = service.startTrip(vehicleId, "driver-a", "R1");

        assertEquals("RUNNING", result.getStatus());
        assertEquals(0.0, result.getSpeed());
        verify(jdbcTemplate).update(
                contains("INSERT INTO vehicle_runtime"),
                eq(vehicleId),
                eq("R1"),
                eq("driver-a"),
                eq(36.111111),
                eq(117.222222),
                eq(0.0),
                eq("RUNNING")
        );
    }

    @Test
    void stopTripReturnsNullWhenVehicleDoesNotExist() {
        mockVehicleQuery("BUS-99", List.of());

        VehicleLocation result = service.stopTrip("BUS-99");

        assertNull(result);
        verify(jdbcTemplate, never()).update(contains("INSERT INTO vehicle_runtime"), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void updateLocationThrowsWhenTripHasNotStarted() {
        mockVehicleQuery("BUS-01", List.of());

        assertThrows(TripStateException.class,
                () -> service.updateLocation("BUS-01", "driver-a", "R1", 36.123456, 117.123456, 8.0));
    }

    @Test
    void updateLocationWritesRuntimeAndHistoryWhenTripIsRunning() {
        String vehicleId = "BUS-02";
        VehicleLocation current = vehicle(vehicleId, "driver-b", "R2", 36.200000, 117.200000, 5.0, "RUNNING");
        VehicleLocation updated = vehicle(vehicleId, "driver-b", "R2", 36.234567, 117.345678, 8.5, "RUNNING");
        RouteInfo route = new RouteInfo();
        route.setRouteId("R2");
        route.setRouteName("route-two");

        mockVehicleQuery(vehicleId, List.of(current), List.of(updated));
        when(routeService.getRoute("R2")).thenReturn(route);

        VehicleLocation result = service.updateLocation(vehicleId, "driver-b", "R2", 36.234567, 117.345678, 8.5);

        assertEquals("RUNNING", result.getStatus());
        assertEquals(36.234567, result.getLatitude());
        assertEquals(117.345678, result.getLongitude());
        verify(jdbcTemplate).update(
                contains("INSERT INTO vehicle_runtime"),
                eq(vehicleId),
                eq("R2"),
                eq("driver-b"),
                eq(36.234567),
                eq(117.345678),
                eq(8.5),
                eq("RUNNING")
        );
        verify(jdbcTemplate).update(
                contains("INSERT INTO vehicle_location_history"),
                eq(vehicleId),
                eq("R2"),
                eq(36.234567),
                eq(117.345678),
                eq(8.5)
        );
    }

    @SafeVarargs
    private final void mockVehicleQuery(String vehicleId, List<VehicleLocation>... results) {
        when(jdbcTemplate.query(anyString(), rowMapper(), eq(vehicleId)))
                .thenReturn(results[0], Arrays.copyOfRange(results, 1, results.length));
    }

    @SuppressWarnings("unchecked")
    private RowMapper<VehicleLocation> rowMapper() {
        return (RowMapper<VehicleLocation>) org.mockito.ArgumentMatchers.any(RowMapper.class);
    }

    private VehicleLocation vehicle(String vehicleId, String driverName, String routeId,
                                    Double latitude, Double longitude, Double speed, String status) {
        VehicleLocation location = new VehicleLocation();
        location.setVehicleId(vehicleId);
        location.setDriverName(driverName);
        location.setRouteId(routeId);
        location.setLatitude(latitude);
        location.setLongitude(longitude);
        location.setSpeed(speed);
        location.setStatus(status);
        return location;
    }
}
