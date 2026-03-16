"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRequestIp = getRequestIp;
function getRequestIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
        return xff.split(',')[0]?.trim() ?? null;
    }
    return req.ip ?? null;
}
//# sourceMappingURL=request.utils.js.map