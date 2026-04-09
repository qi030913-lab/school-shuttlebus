const BASE_URL = 'https://gps.hiwcq.com'

function getDriverToken() {
  const driverInfo = wx.getStorageSync('driverInfo') || {}
  return driverInfo.loginToken || ''
}

function buildRequestError(res, body) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const message = payload.message || payload.msg || `Request failed with status ${res.statusCode}`

  return Object.assign({}, payload, {
    success: false,
    message,
    statusCode: res.statusCode
  })
}

function request(url, method = 'GET', data = {}, extraHeader = {}) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({
      'content-type': 'application/json'
    }, extraHeader)

    const token = getDriverToken()
    if (token) {
      headers['X-Driver-Token'] = token
    }

    wx.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      header: headers,
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
  request
}
