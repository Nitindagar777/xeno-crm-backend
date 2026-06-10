const success = (res, data, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    data,
    message
  });
};

const error = (res, message = 'Server Error', statusCode = 500, err = null) => {
  if (err) {
    console.error('[Helper Error Log]:', err);
  }
  return res.status(statusCode).json({
    success: false,
    error: message,
    message
  });
};

module.exports = { success, error };
