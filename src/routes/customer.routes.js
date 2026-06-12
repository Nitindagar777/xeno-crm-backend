const express = require('express');
const multer = require('multer');
const customerController = require('../controllers/customer.controller');
const authMiddleware = require('../middleware/auth.middleware');
const workspaceMiddleware = require('../middleware/workspace.middleware');

const router = express.Router();

// Multer in-memory storage config
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (['csv', 'xlsx', 'xls', 'json'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV, Excel (.xlsx, .xls) and JSON files are allowed'), false);
    }
  }
});

// Protect all routes
router.use(authMiddleware);
router.use(workspaceMiddleware);

router.get('/', customerController.getCustomers);
router.get('/metadata', customerController.getMetadata);
router.post('/', customerController.createCustomer);
router.post('/import', upload.single('file'), customerController.importCSV);
router.post('/import-preview', upload.single('file'), customerController.importPreview);
router.get('/:id', customerController.getCustomer);
router.put('/:id', customerController.updateCustomer);
router.delete('/:id', customerController.deleteCustomer);

module.exports = router;
