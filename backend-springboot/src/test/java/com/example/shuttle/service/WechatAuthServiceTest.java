package com.example.shuttle.service;

import com.example.shuttle.config.WechatMiniAppProperties;
import com.example.shuttle.model.WxCode2SessionResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WechatAuthServiceTest {

    private WechatMiniAppProperties properties;

    @BeforeEach
    void setUp() {
        properties = new WechatMiniAppProperties();
    }

    @Test
    void codeToSessionThrowsWhenCodeIsBlank() {
        WechatAuthService service = new WechatAuthService(properties);

        assertThrows(IllegalArgumentException.class, () -> service.codeToSession(" "));
    }

    @Test
    void codeToSessionReturnsStableMockIdentityWhenMockLoginEnabled() {
        properties.setMockLoginEnabled(true);
        WechatAuthService service = new WechatAuthService(properties);

        WxCode2SessionResult first = service.codeToSession("code-1");
        WxCode2SessionResult second = service.codeToSession("code-1");
        WxCode2SessionResult third = service.codeToSession("code-2");

        assertTrue(first.isMockMode());
        assertTrue(first.getOpenId().startsWith("mock_"));
        assertTrue(first.getSessionKey().startsWith("mock_session_"));
        assertEquals(first.getOpenId(), second.getOpenId());
        assertEquals(first.getSessionKey(), second.getSessionKey());
        assertNotEquals(first.getOpenId(), third.getOpenId());
    }

    @Test
    void codeToSessionThrowsWhenMockDisabledAndWechatConfigMissing() {
        properties.setMockLoginEnabled(false);
        WechatAuthService service = new WechatAuthService(properties);

        IllegalStateException ex = assertThrows(IllegalStateException.class, () -> service.codeToSession("code-1"));

        assertFalse(ex.getMessage().isBlank());
    }
}
