# 接口清单

## 1. 公共接口

### GET /api/common/routes

查询全部线路信息。

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

### GET /api/driver/me

读取当前登录司机信息。

### POST /api/driver/start

司机发车。

### POST /api/driver/stop

司机收车。

### POST /api/driver/location

上传车辆实时位置。

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

返回某条线路的线路信息与车辆实时视图。

## 4. WebSocket

### wss://gps.hiwcq.com/ws/vehicles

后端广播全部车辆最新状态给用户端。
