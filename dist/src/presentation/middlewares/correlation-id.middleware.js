"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.correlationIdMiddleware = correlationIdMiddleware;
const crypto_1 = require("crypto");
function correlationIdMiddleware(req, res, next) {
    const header = req.headers['x-correlation-id'];
    const correlationId = typeof header === 'string' && header.length > 0 ? header : (0, crypto_1.randomUUID)();
    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
}
//# sourceMappingURL=correlation-id.middleware.js.map