package com.example.shuttle.ws;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class VehicleWebSocketHandler extends TextWebSocketHandler {

    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        removeSession(session, CloseStatus.SERVER_ERROR);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        session.sendMessage(new TextMessage("connected"));
    }

    public void broadcast(String json) {
        for (WebSocketSession session : sessions) {
            if (!session.isOpen()) {
                sessions.remove(session);
                continue;
            }

            try {
                session.sendMessage(new TextMessage(json));
            } catch (IOException ex) {
                removeSession(session, CloseStatus.SERVER_ERROR);
            }
        }
    }

    private void removeSession(WebSocketSession session, CloseStatus closeStatus) {
        if (session == null) {
            return;
        }

        sessions.remove(session);
        if (session.isOpen()) {
            try {
                session.close(closeStatus);
            } catch (IOException ignored) {
            }
        }
    }
}
