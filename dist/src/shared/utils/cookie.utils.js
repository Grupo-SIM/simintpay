"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAccessTokenCookie = setAccessTokenCookie;
function setAccessTokenCookie(res, token) {
    res.cookie('access_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 15 * 60 * 1000,
    });
}
//# sourceMappingURL=cookie.utils.js.map