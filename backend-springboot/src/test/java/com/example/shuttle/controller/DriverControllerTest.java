package com.example.shuttle.controller;

import com.example.shuttle.exception.DriverAccountConflictException;
import com.example.shuttle.exception.TripStateException;
import com.example.shuttle.model.DriverAccount;
import com.example.shuttle.model.DriverSession;
import com.example.shuttle.model.VehicleLocation;
import com.example.shuttle.model.WxCode2SessionResult;
import com.example.shuttle.service.DriverAccountService;
import com.example.shuttle.service.DriverSessionService;
import com.example.shuttle.service.VehicleLocationService;
import com.example.shuttle.service.WechatAuthService;
import com.example.shuttle.ws.VehicleWebSocketHandler;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(DriverController.class)
class DriverControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private VehicleLocationService vehicleLocationService;

    @MockBean
    private VehicleWebSocketHandler vehicleWebSocketHandler;

    @MockBean
    private DriverAccountService driverAccountService;

    @MockBean
    private DriverSessionService driverSessionService;

    @MockBean
    private WechatAuthService wechatAuthService;

    @Test
    void wxLoginReturnsBadRequestWhenRequiredFieldsAreMissing() throws Exception {
        mockMvc.perform(post("/api/driver/wx-login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "code": "",
                                  "driverName": "driver-a",
                                  "vehicleId": "BUS-01",
                                  "routeId": "R1"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));

        verify(wechatAuthService, never()).codeToSession(anyString());
        verify(driverAccountService, never()).bindOrRegisterByOpenId(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void wxLoginReturnsLoginTokenAndDriverInfo() throws Exception {
        WxCode2SessionResult sessionInfo = new WxCode2SessionResult();
        sessionInfo.setOpenId("openid-1");
        sessionInfo.setMockMode(true);

        DriverAccount account = driverAccount("openid-1", "driver-a", "BUS-01", "R1");
        DriverSession session = driverSession("token-1234567890abcdef1234567890ab", "openid-1", "BUS-01");

        when(wechatAuthService.codeToSession("wx-code")).thenReturn(sessionInfo);
        when(driverAccountService.bindOrRegisterByOpenId("openid-1", "driver-a", "BUS-01", "R1"))
                .thenReturn(account);
        when(driverSessionService.createOrRefresh("openid-1", "BUS-01")).thenReturn(session);

        mockMvc.perform(post("/api/driver/wx-login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "code": "wx-code",
                                  "driverName": "driver-a",
                                  "vehicleId": "BUS-01",
                                  "routeId": "R1"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.loginToken").value("token-1234567890abcdef1234567890ab"))
                .andExpect(jsonPath("$.data.driver.openId").value("openid-1"))
                .andExpect(jsonPath("$.data.driver.vehicleId").value("BUS-01"))
                .andExpect(jsonPath("$.data.mockMode").value(true));
    }

    @Test
    void wxLoginReturnsConflictWhenVehicleBindingFails() throws Exception {
        WxCode2SessionResult sessionInfo = new WxCode2SessionResult();
        sessionInfo.setOpenId("openid-2");

        when(wechatAuthService.codeToSession("wx-code")).thenReturn(sessionInfo);
        when(driverAccountService.bindOrRegisterByOpenId("openid-2", "driver-b", "BUS-01", "R1"))
                .thenThrow(new DriverAccountConflictException("Vehicle is already bound to another driver account"));

        mockMvc.perform(post("/api/driver/wx-login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "code": "wx-code",
                                  "driverName": "driver-b",
                                  "vehicleId": "BUS-01",
                                  "routeId": "R1"
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Vehicle is already bound to another driver account"));
    }

    @Test
    void startTripReturnsUpdatedVehicleAndBroadcastsSnapshot() throws Exception {
        DriverSession session = driverSession("token-start", "openid-1", "BUS-01");
        DriverAccount account = driverAccount("openid-1", "driver-a", "BUS-01", "R1");
        VehicleLocation location = vehicleLocation("BUS-01", "driver-a", "R1", 36.123456, 117.123456, 0.0, "RUNNING");

        when(driverSessionService.requireValidToken("token-start")).thenReturn(session);
        when(driverAccountService.findByOpenId("openid-1")).thenReturn(account);
        when(vehicleLocationService.startTrip("BUS-01", "driver-a", "R1")).thenReturn(location);
        when(vehicleLocationService.getAll()).thenReturn(List.of(location));

        mockMvc.perform(post("/api/driver/start")
                        .header("X-Driver-Token", "token-start")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.vehicleId").value("BUS-01"))
                .andExpect(jsonPath("$.data.status").value("RUNNING"));

        verify(vehicleLocationService).startTrip("BUS-01", "driver-a", "R1");
        verify(vehicleWebSocketHandler).broadcast(anyString());
    }

    @Test
    void stopTripReturnsUpdatedVehicleAndBroadcastsSnapshot() throws Exception {
        DriverSession session = driverSession("token-stop", "openid-1", "BUS-01");
        DriverAccount account = driverAccount("openid-1", "driver-a", "BUS-01", "R1");
        VehicleLocation location = vehicleLocation("BUS-01", "driver-a", "R1", 36.123456, 117.123456, 0.0, "STOPPED");

        when(driverSessionService.requireValidToken("token-stop")).thenReturn(session);
        when(driverAccountService.findByOpenId("openid-1")).thenReturn(account);
        when(vehicleLocationService.stopTrip("BUS-01")).thenReturn(location);
        when(vehicleLocationService.getAll()).thenReturn(List.of(location));

        mockMvc.perform(post("/api/driver/stop")
                        .header("X-Driver-Token", "token-stop")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.vehicleId").value("BUS-01"))
                .andExpect(jsonPath("$.data.status").value("STOPPED"));

        verify(vehicleLocationService).stopTrip("BUS-01");
        verify(vehicleWebSocketHandler).broadcast(anyString());
    }

    @Test
    void uploadLocationReturnsUpdatedVehicleAndBroadcastsSnapshot() throws Exception {
        DriverSession session = driverSession("token-upload", "openid-1", "BUS-01");
        DriverAccount account = driverAccount("openid-1", "driver-a", "BUS-01", "R1");
        VehicleLocation location = vehicleLocation("BUS-01", "driver-a", "R1", 36.123456, 117.123456, 8.5, "RUNNING");

        when(driverSessionService.requireValidToken("token-upload")).thenReturn(session);
        when(driverAccountService.findByOpenId("openid-1")).thenReturn(account);
        when(vehicleLocationService.updateLocation("BUS-01", "driver-a", "R1", 36.123456, 117.123456, 8.5))
                .thenReturn(location);
        when(vehicleLocationService.getAll()).thenReturn(List.of(location));

        mockMvc.perform(post("/api/driver/location")
                        .header("X-Driver-Token", "token-upload")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "latitude": 36.123456,
                                  "longitude": 117.123456,
                                  "speed": 8.5
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.vehicleId").value("BUS-01"))
                .andExpect(jsonPath("$.data.status").value("RUNNING"));

        verify(vehicleLocationService).updateLocation("BUS-01", "driver-a", "R1", 36.123456, 117.123456, 8.5);
        verify(vehicleWebSocketHandler).broadcast(anyString());
    }

    @Test
    void uploadLocationReturnsUnauthorizedWhenDriverTokenIsMissingOrInvalid() throws Exception {
        when(driverSessionService.requireValidToken(null))
                .thenThrow(new IllegalStateException("Login token is invalid or expired"));

        mockMvc.perform(post("/api/driver/location")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "latitude": 36.123456,
                                  "longitude": 117.123456,
                                  "speed": 8.5
                                }
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Login token is invalid or expired"));

        verify(vehicleLocationService, never()).updateLocation(anyString(), anyString(), anyString(), any(), any(), any());
        verify(vehicleWebSocketHandler, never()).broadcast(anyString());
    }

    @Test
    void uploadLocationReturnsConflictWhenTripHasNotStarted() throws Exception {
        DriverSession session = driverSession("token-conflict", "openid-2", "BUS-02");
        DriverAccount account = driverAccount("openid-2", "driver-b", "BUS-02", "R2");

        when(driverSessionService.requireValidToken("token-conflict")).thenReturn(session);
        when(driverAccountService.findByOpenId("openid-2")).thenReturn(account);
        when(vehicleLocationService.updateLocation("BUS-02", "driver-b", "R2", 36.223456, 117.223456, 0.0))
                .thenThrow(new TripStateException("Trip has not started"));

        mockMvc.perform(post("/api/driver/location")
                        .header("X-Driver-Token", "token-conflict")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "latitude": 36.223456,
                                  "longitude": 117.223456,
                                  "speed": 0.0
                                }
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Trip has not started"));

        verify(vehicleWebSocketHandler, never()).broadcast(anyString());
    }

    private DriverAccount driverAccount(String openId, String driverName, String vehicleId, String routeId) {
        DriverAccount account = new DriverAccount();
        account.setOpenId(openId);
        account.setDriverName(driverName);
        account.setVehicleId(vehicleId);
        account.setRouteId(routeId);
        account.setEnabled(true);
        return account;
    }

    private DriverSession driverSession(String loginToken, String openId, String vehicleId) {
        DriverSession session = new DriverSession();
        session.setLoginToken(loginToken);
        session.setOpenId(openId);
        session.setVehicleId(vehicleId);
        return session;
    }

    private VehicleLocation vehicleLocation(String vehicleId, String driverName, String routeId,
                                            double latitude, double longitude, double speed, String status) {
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
