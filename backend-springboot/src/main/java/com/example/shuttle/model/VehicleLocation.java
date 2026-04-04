package com.example.shuttle.model;

import java.time.LocalDateTime;

public class VehicleLocation {
    private String vehicleId;
    private String driverName;
    private String routeId;
    private String routeName;
    private Double latitude;
    private Double longitude;
    private Double speed;
    private String status;
    private String nearestStationName;
    private Double distanceToNearestStationMeters;
    private Integer etaMinutes;
    private LocalDateTime updateTime;

    public String getVehicleId() {
        return vehicleId;
    }

    public void setVehicleId(String vehicleId) {
        this.vehicleId = vehicleId;
    }

    public String getDriverName() {
        return driverName;
    }

    public void setDriverName(String driverName) {
        this.driverName = driverName;
    }

    public String getRouteId() {
        return routeId;
    }

    public void setRouteId(String routeId) {
        this.routeId = routeId;
    }

    public String getRouteName() {
        return routeName;
    }

    public void setRouteName(String routeName) {
        this.routeName = routeName;
    }

    public Double getLatitude() {
        return latitude;
    }

    public void setLatitude(Double latitude) {
        this.latitude = latitude;
    }

    public Double getLongitude() {
        return longitude;
    }

    public void setLongitude(Double longitude) {
        this.longitude = longitude;
    }

    public Double getSpeed() {
        return speed;
    }

    public void setSpeed(Double speed) {
        this.speed = speed;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getNearestStationName() {
        return nearestStationName;
    }

    public void setNearestStationName(String nearestStationName) {
        this.nearestStationName = nearestStationName;
    }

    public Double getDistanceToNearestStationMeters() {
        return distanceToNearestStationMeters;
    }

    public void setDistanceToNearestStationMeters(Double distanceToNearestStationMeters) {
        this.distanceToNearestStationMeters = distanceToNearestStationMeters;
    }

    public Integer getEtaMinutes() {
        return etaMinutes;
    }

    public void setEtaMinutes(Integer etaMinutes) {
        this.etaMinutes = etaMinutes;
    }

    public LocalDateTime getUpdateTime() {
        return updateTime;
    }

    public void setUpdateTime(LocalDateTime updateTime) {
        this.updateTime = updateTime;
    }
}
