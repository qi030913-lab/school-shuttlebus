package com.example.shuttle.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "wechat.miniapp")
public class WechatMiniAppProperties {
    private String appId;
    private String secret;
    private boolean mockLoginEnabled = true;
    private int sessionExpireDays = 7;

    public String getAppId() {
        return appId;
    }

    public void setAppId(String appId) {
        this.appId = appId;
    }

    public String getSecret() {
        return secret;
    }

    public void setSecret(String secret) {
        this.secret = secret;
    }

    public boolean isMockLoginEnabled() {
        return mockLoginEnabled;
    }

    public void setMockLoginEnabled(boolean mockLoginEnabled) {
        this.mockLoginEnabled = mockLoginEnabled;
    }

    public int getSessionExpireDays() {
        return sessionExpireDays;
    }

    public void setSessionExpireDays(int sessionExpireDays) {
        this.sessionExpireDays = sessionExpireDays;
    }
}
