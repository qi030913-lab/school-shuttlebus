package com.example.shuttle.controller;

import com.example.shuttle.dto.DriverWxLoginRequest;
import com.example.shuttle.dto.LocationUploadRequest;
import com.example.shuttle.exception.DriverAccountConflictException;
import com.example.shuttle.exception.TripStateException;
import com.example.shuttle.model.ApiResponse;
import com.example.shuttle.model.DriverAccount;
import com.example.shuttle.model.DriverLoginResult;
import com.example.shuttle.model.DriverSession;
import com.example.shuttle.model.VehicleLocation;
import com.example.shuttle.model.WxCode2SessionResult;
import com.example.shuttle.service.DriverAccountService;
import com.example.shuttle.service.DriverSessionService;
import com.example.shuttle.service.VehicleLocationService;
import com.example.shuttle.service.WechatAuthService;
import com.example.shuttle.ws.VehicleWebSocketHandler;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/driver")
public class DriverController {
    private static final String DRIVER_TOKEN_HEADER = "X-Driver-Token";

    private final VehicleLocationService vehicleLocationService;
    private final VehicleWebSocketHandler vehicleWebSocketHandler;
    private final DriverAccountService driverAccountService;
    private final DriverSessionService driverSessionService;
    private final WechatAuthService wechatAuthService;

    public DriverController(VehicleLocationService vehicleLocationService,
                            VehicleWebSocketHandler vehicleWebSocketHandler,
                            DriverAccountService driverAccountService,
                            DriverSessionService driverSessionService,
                            WechatAuthService wechatAuthService) {
        this.vehicleLocationService = vehicleLocationService;
        this.vehicleWebSocketHandler = vehicleWebSocketHandler;
        this.driverAccountService = driverAccountService;
        this.driverSessionService = driverSessionService;
        this.wechatAuthService = wechatAuthService;
    }

    @PostMapping("/wx-login")
    public ResponseEntity<ApiResponse<DriverLoginResult>> wxLogin(@RequestBody DriverWxLoginRequest request) {
        if (isBlank(request.getDriverName()) || isBlank(request.getVehicleId()) || isBlank(request.getRouteId()) || isBlank(request.getCode())) {
            return ResponseEntity.badRequest().body(new ApiResponse<>(false, "code、司机姓名、车辆编号、线路不能为空", null));
        }
        WxCode2SessionResult sessionInfo = wechatAuthService.codeToSession(request.getCode());
        DriverAccount account = driverAccountService.bindOrRegisterByOpenId(
                sessionInfo.getOpenId(),
                request.getDriverName(),
                request.getVehicleId(),
                request.getRouteId()
        );
        DriverSession session = driverSessionService.createOrRefresh(account.getOpenId(), account.getVehicleId());
        DriverLoginResult result = new DriverLoginResult();
        result.setLoginToken(session.getLoginToken());
        result.setDriver(account);
        result.setMockMode(sessionInfo.isMockMode());
        return ResponseEntity.ok(ApiResponse.ok("登录成功", result));
    }

    @GetMapping("/me")
    public ResponseEntity<ApiResponse<DriverAccount>> me(HttpServletRequest request) {
        DriverSession session = requireSession(request);
        DriverAccount account = driverAccountService.findByOpenId(session.getOpenId());
        if (account == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(new ApiResponse<>(false, "司机账号不存在，请重新登录", null));
        }
        return ResponseEntity.ok(ApiResponse.ok(account));
    }

    @PostMapping("/start")
    public ResponseEntity<ApiResponse<VehicleLocation>> start(HttpServletRequest servletRequest) {
        DriverAccount account = requireDriverAccount(servletRequest);
        VehicleLocation location = vehicleLocationService.startTrip(account.getVehicleId(), account.getDriverName(), account.getRouteId());
        pushAllVehicles();
        return ResponseEntity.ok(ApiResponse.ok("已发车", location));
    }

    @PostMapping("/stop")
    public ResponseEntity<ApiResponse<VehicleLocation>> stop(HttpServletRequest servletRequest) {
        DriverAccount account = requireDriverAccount(servletRequest);
        VehicleLocation location = vehicleLocationService.stopTrip(account.getVehicleId());
        pushAllVehicles();
        return ResponseEntity.ok(ApiResponse.ok("已收车", location));
    }

    @PostMapping("/location")
    public ResponseEntity<ApiResponse<VehicleLocation>> uploadLocation(@RequestBody LocationUploadRequest request,
                                                                       HttpServletRequest servletRequest) {
        DriverAccount account = requireDriverAccount(servletRequest);
        VehicleLocation location = vehicleLocationService.updateLocation(
                account.getVehicleId(),
                account.getDriverName(),
                account.getRouteId(),
                request.getLatitude(),
                request.getLongitude(),
                request.getSpeed()
        );
        pushAllVehicles();
        return ResponseEntity.ok(ApiResponse.ok("位置已更新", location));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<ApiResponse<Object>> handleIllegalState(IllegalStateException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(new ApiResponse<>(false, ex.getMessage(), null));
    }

    @ExceptionHandler(TripStateException.class)
    public ResponseEntity<ApiResponse<Object>> handleTripState(TripStateException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ApiResponse<>(false, ex.getMessage(), null));
    }

    @ExceptionHandler(DriverAccountConflictException.class)
    public ResponseEntity<ApiResponse<Object>> handleDriverAccountConflict(DriverAccountConflictException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ApiResponse<>(false, ex.getMessage(), null));
    }

    private DriverSession requireSession(HttpServletRequest request) {
        String token = request.getHeader(DRIVER_TOKEN_HEADER);
        return driverSessionService.requireValidToken(token);
    }

    private DriverAccount requireDriverAccount(HttpServletRequest request) {
        DriverSession session = requireSession(request);
        DriverAccount account = driverAccountService.findByOpenId(session.getOpenId());
        if (account == null) {
            throw new IllegalStateException("司机账号不存在，请重新登录");
        }
        return account;
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private void pushAllVehicles() {
        String json = JsonUtils.toJson(ApiResponse.ok(vehicleLocationService.getAll()));
        vehicleWebSocketHandler.broadcast(json);
    }
}
