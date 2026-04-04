# 接口清单

## 1. 公共接口

### GET /api/common/routes

查询全部线路与站点。

### GET /api/common/routes/{routeId}/stations

查询指定线路的站点列表。

## 2. 司机端接口

### POST /api/driver/wx-login

司机通过微信小程序 `wx.login` 获取 `code` 后，提交到后端完成登录与绑定。

请求体：

```json
{
  "code": "微信登录返回的code",
  "driverName": "张师傅",
  "vehicleId": "BUS-01",
  "routeId": "R1"
}
```

返回示例：

```json
{
  "success": true,
  "message": "登录成功",
  "data": {
    "loginToken": "baf5...",
    "mockMode": true,
    "driver": {
      "openId": "mock_xxx",
      "driverName": "张师傅",
      "vehicleId": "BUS-01",
      "routeId": "R1",
      "enabled": true
    }
  }
}
```

### GET /api/driver/me

读取当前登录司机信息。

请求头：

```http
X-Driver-Token: 登录成功返回的loginToken
```

### POST /api/driver/start

司机发车。

请求头：

```http
X-Driver-Token: 登录成功返回的loginToken
```

### POST /api/driver/stop

司机收车。

请求头：

```http
X-Driver-Token: 登录成功返回的loginToken
```

### POST /api/driver/location

上传车辆定位。

请求头：

```http
X-Driver-Token: 登录成功返回的loginToken
```

请求体：

```json
{
  "latitude": 39.9091,
  "longitude": 116.3972,
  "speed": 8.6
}
```

## 3. 用户端接口

### GET /api/user/vehicles?routeId=R1

查看某条线路当前车辆。

### GET /api/user/vehicles/{vehicleId}

查看单车详情。

### GET /api/user/overview?routeId=R1

返回某条线路的线路、站点、车辆整合视图。

## 4. WebSocket

### wss://gps.hiwcq.com/ws/vehicles

后端广播全部车辆最新状态给用户端。
