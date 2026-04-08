const BASE_URL = 'https://gps.hiwcq.com'
const WS_URL = 'wss://gps.hiwcq.com/ws/vehicles'

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
        if (body.success === false) {
          reject(body)
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
