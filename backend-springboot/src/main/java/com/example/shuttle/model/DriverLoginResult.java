package com.example.shuttle.model;

public class DriverLoginResult {
    private String loginToken;
    private DriverAccount driver;
    private boolean mockMode;

    public String getLoginToken() {
        return loginToken;
    }

    public void setLoginToken(String loginToken) {
        this.loginToken = loginToken;
    }

    public DriverAccount getDriver() {
        return driver;
    }

    public void setDriver(DriverAccount driver) {
        this.driver = driver;
    }

    public boolean isMockMode() {
        return mockMode;
    }

    public void setMockMode(boolean mockMode) {
        this.mockMode = mockMode;
    }
}
