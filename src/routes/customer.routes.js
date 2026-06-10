const express = require('express');
const multer = require('multer');
const customerController = require('../controllers/customer.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

// Multer in-memory storage config
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

// Protect all routes
router.use(authMiddleware);

router.get('/', customerController.getCustomers);
router.get('/metadata', customerController.getMetadata);
router.post('/', customerController.createCustomer);
router.post('/import', upload.single('file'), customerController.importCSV);
router.get('/:id', customerController.getCustomer);
router.put('/:id', customerController.updateCustomer);
router.delete('/:id', customerController.deleteCustomer);

module.exports = router;
