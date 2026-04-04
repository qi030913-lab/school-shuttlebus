package com.example.shuttle.model;

import java.util.List;

public class RouteOverview {
    private RouteInfo route;
    private List<StationInfo> stations;
    private List<VehicleLocation> vehicles;

    public RouteInfo getRoute() {
        return route;
    }

    public void setRoute(RouteInfo route) {
        this.route = route;
    }

    public List<StationInfo> getStations() {
        return stations;
    }

    public void setStations(List<StationInfo> stations) {
        this.stations = stations;
    }

    public List<VehicleLocation> getVehicles() {
        return vehicles;
    }

    public void setVehicles(List<VehicleLocation> vehicles) {
        this.vehicles = vehicles;
    }
}
