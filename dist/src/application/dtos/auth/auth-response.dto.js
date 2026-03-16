"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthResponseDto = exports.AuthResponseUserDto = void 0;
class AuthResponseUserDto {
    id;
    name;
    email;
    role;
}
exports.AuthResponseUserDto = AuthResponseUserDto;
class AuthResponseDto {
    accessToken;
    refreshToken;
    expiresIn;
    user;
}
exports.AuthResponseDto = AuthResponseDto;
//# sourceMappingURL=auth-response.dto.js.map