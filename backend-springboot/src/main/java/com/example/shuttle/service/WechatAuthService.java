package com.example.shuttle.service;

import com.example.shuttle.config.WechatMiniAppProperties;
import com.example.shuttle.model.WxCode2SessionResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;

@Service
public class WechatAuthService {
    private static final String CODE_TO_SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session";

    private final WechatMiniAppProperties properties;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public WechatAuthService(WechatMiniAppProperties properties) {
        this.properties = properties;
        this.objectMapper = new ObjectMapper();
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    public WxCode2SessionResult codeToSession(String code) {
        if (code == null || code.isBlank()) {
            throw new IllegalArgumentException("code 不能为空");
        }
        if (properties.isMockLoginEnabled() || isBlank(properties.getAppId()) || isBlank(properties.getSecret())) {
            return buildMockResult(code);
        }
        try {
            String url = CODE_TO_SESSION_URL
                    + "?appid=" + encode(properties.getAppId())
                    + "&secret=" + encode(properties.getSecret())
                    + "&js_code=" + encode(code)
                    + "&grant_type=authorization_code";
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .GET()
                    .timeout(Duration.ofSeconds(10))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            JsonNode root = objectMapper.readTree(response.body());
            if (root.hasNonNull("errcode") && root.get("errcode").asInt() != 0) {
                String message = root.path("errmsg").asText("微信登录失败");
                throw new IllegalStateException("微信登录失败: " + message);
            }
            String openId = root.path("openid").asText(null);
            if (openId == null || openId.isBlank()) {
                throw new IllegalStateException("微信登录失败: 未返回 openid");
            }
            WxCode2SessionResult result = new WxCode2SessionResult();
            result.setOpenId(openId);
            result.setSessionKey(root.path("session_key").asText(null));
            result.setMockMode(false);
            return result;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("调用微信登录接口被中断: " + ex.getMessage(), ex);
        } catch (IOException ex) {
            throw new IllegalStateException("调用微信登录接口失败: " + ex.getMessage(), ex);
        }
    }

    private WxCode2SessionResult buildMockResult(String code) {
        WxCode2SessionResult result = new WxCode2SessionResult();
        result.setOpenId("mock_" + sha256(code).substring(0, 24));
        result.setSessionKey("mock_session_" + sha256("session_" + code).substring(0, 24));
        result.setMockMode(true);
        return result;
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(input.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }
}
