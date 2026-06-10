const { error } = require('../utils/responseHelper');

module.exports = (err, req, res, next) => {
  console.error('[SERVER ERROR]:', err);

  let statusCode = err.statusCode || 500;
  let message = err.message || 'An unexpected error occurred';
  let errDetails = null;

  // Handle Mongoose Validation Error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map(val => val.message).join(', ');
  }

  // Handle Mongoose Duplicate Key Error
  if (err.code === 11000) {
    statusCode = 400;
    const key = Object.keys(err.keyValue)[0];
    message = `Duplicate field value entered: '${key}'. Please use another value.`;
  }

  // Handle Mongoose Bad ObjectId (CastError)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Resource not found with id of ${err.value}`;
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token. Please log in again.';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Your token has expired. Please log in again.';
  }

  return error(res, message, statusCode, process.env.NODE_ENV === 'development' ? err : null);
};
