const BASE_URL = 'https://gps.hiwcq.com'
const WS_URL = 'wss://gps.hiwcq.com/ws/vehicles'

function buildRequestError(res, body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const message = payload.message || payload.msg || `Request failed with status ${res.statusCode}`

  return Object.assign({}, payload, {
    success: false,
    message,
    statusCode: res.statusCode
  })
}

function request(url, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      header: {
        'content-type': 'application/json'
      },
      success: res => {
        const body = res.data || {}
        if (res.statusCode >= 400 || body.success === false) {
          reject(buildRequestError(res, body))
          return
        }
        resolve(body.data !== undefined ? body.data : body)
      },
      fail: err => reject(err)
    })
  })
}

module.exports = {
  BASE_URL,
  WS_URL,
  request
}
