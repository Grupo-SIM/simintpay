"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiDomClient = void 0;
const axios_1 = require("@nestjs/axios");
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
let ApiDomClient = class ApiDomClient {
    http;
    constructor(http) {
        this.http = http;
    }
    toSafeString(value) {
        if (value == null)
            return null;
        if (typeof value === 'string')
            return value.length > 0 ? value : null;
        if (typeof value === 'number')
            return Number.isFinite(value) ? String(value) : null;
        if (typeof value === 'boolean')
            return value ? 'true' : 'false';
        if (typeof value === 'bigint')
            return value.toString();
        return null;
    }
    getObject(value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value;
        }
        return null;
    }
    pickString(obj, key) {
        if (!obj)
            return null;
        const v = obj[key];
        return this.toSafeString(v);
    }
    pickNestedString(obj, keys) {
        let cur = obj;
        for (const k of keys) {
            const o = this.getObject(cur);
            if (!o)
                return null;
            cur = o[k];
        }
        return this.toSafeString(cur);
    }
    get baseUrl() {
        const base = process.env.API_DOM_URL ?? 'http://localhost:3333';
        return base.replace(/\/$/, '');
    }
    get domRealApiUrl() {
        const base = process.env.DOM_REAL_API_URL ?? 'https://apiv3.dompagamentos.com.br/checkout/production';
        return base.replace(/\/$/, '');
    }
    normalizeDomApiResponse(data) {
        const id = this.pickString(data, 'id');
        if (!id)
            return null;
        const feeDetails = this.getObject(data.fee_details ?? null);
        const feeAmount = this.pickNumber(feeDetails, 'amount') ?? 0;
        const amountCents = this.pickNumber(data, 'amount') ?? 0;
        const amount = amountCents / 100;
        const rawLiquidCents = this.pickNumber(data, 'liquid_amount');
        const totalLiquid = (rawLiquidCents != null && rawLiquidCents >= 0)
            ? rawLiquidCents / 100
            : Math.max(0, amount - feeAmount);
        const status = this.pickString(data, 'status') ?? '';
        const isPaid = status === 'paid' || status === 'approved' || status === 'completed';
        const order = {
            order_id: this.pickString(data, 'cod_external') ?? id,
            id_transaction: id,
            type: status,
            type_payment: this.pickString(data, 'payment_method') ?? 'PIX',
            date_register: this.pickString(data, 'created_at'),
            origin: 'DOM Pagamentos',
            total: amount,
            total_liquid: totalLiquid,
            fee_total_value: feeAmount,
            mdr_value: feeAmount,
            fee_installment_value: 0,
            paid_date: isPaid ? (this.pickString(data, 'updated_at') ?? null) : null,
            msg_3ds: null,
        };
        const customer = this.getObject(data.customer ?? data.payer ?? null);
        if (customer) {
            order.client_name = this.pickString(customer, 'name');
            order.client_document = this.pickString(customer, 'document') ?? this.pickString(customer, 'cpf');
            order.client_email = this.pickString(customer, 'email');
            order.client_phone = this.pickString(customer, 'mobile_phone') ?? this.pickString(customer, 'phone') ?? this.pickString(customer, 'mobile');
        }
        order.pix_content = this.pickString(data, 'pix_content');
        const rawItems = Array.isArray(data.items) ? data.items : [];
        order.items = rawItems.length > 0
            ? rawItems.map((it) => ({ name: it.description ?? it.name ?? 'Produto', quant: it.quantity ?? it.quant ?? 1, price: (it.price ?? it.amount ?? 0) / 100 }))
            : [{ name: String(data.product_first ?? 'Produto'), quant: 1, price: amount }];
        const rawHistory = Array.isArray(data.status_history) ? data.status_history : [];
        order.historic_status = rawHistory.length > 0
            ? rawHistory.map((h) => ({ status: h.status, type: h.type ?? h.status, date: h.created_at ?? h.date, color: '#3fa0e5' }))
            : [];
        return { order };
    }
    async register(input) {
        const url = `${this.baseUrl}/auth/register`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.post(url, input));
        const root = this.getObject(res.data);
        const domUserId = this.pickString(root, 'domUserId') ??
            this.pickNestedString(root, ['data', 'domUserId']) ??
            this.pickString(root, 'id');
        if (!domUserId) {
            throw new Error('api-dom register response missing domUserId');
        }
        return { domUserId: String(domUserId) };
    }
    async generateToken(email, password) {
        const url = `${this.baseUrl}/auth/generate-token`;
        try {
            const res = (await (0, rxjs_1.firstValueFrom)(this.http.post(url, {
                email,
                password,
            })));
            const root = this.getObject(res.data);
            const domToken = this.pickString(root, 'token') ??
                this.pickString(root, 'accessToken') ??
                this.pickNestedString(root, ['data', 'token']) ??
                this.pickNestedString(root, ['data', 'accessToken']);
            if (!domToken) {
                throw new Error('api-dom generate-token response missing token');
            }
            const domUserId = this.pickString(root, 'userId') ??
                this.pickNestedString(root, ['data', 'userId']);
            const name = this.pickString(root, 'name') ??
                this.pickNestedString(root, ['data', 'name']);
            const outEmail = this.pickString(root, 'email') ??
                this.pickNestedString(root, ['data', 'email']);
            return {
                domToken: String(domToken),
                domUserId: domUserId ? String(domUserId) : undefined,
                name: name ? String(name) : undefined,
                email: outEmail ? String(outEmail) : undefined,
            };
        }
        catch {
            throw new common_1.UnauthorizedException('Credenciais inválidas');
        }
    }
    async me(domToken) {
        const url = `${this.baseUrl}/auth/me`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.get(url, { headers: { 'x-access-token': domToken } }));
        const root = this.getObject(res.data);
        const payload = this.getObject(root?.data ?? root);
        return {
            id: this.pickString(payload, 'id') ?? undefined,
            name: this.pickString(payload, 'name') ?? undefined,
            email: this.pickString(payload, 'email') ?? undefined,
        };
    }
    pickNumber(obj, key) {
        if (!obj)
            return null;
        const v = obj[key];
        if (typeof v === 'number' && Number.isFinite(v))
            return v;
        if (typeof v === 'string') {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        }
        return null;
    }
    pickBoolean(obj, key) {
        if (!obj)
            return null;
        const v = obj[key];
        if (typeof v === 'boolean')
            return v;
        if (typeof v === 'string') {
            if (v === 'true')
                return true;
            if (v === 'false')
                return false;
        }
        return null;
    }
    getArray(value) {
        return Array.isArray(value) ? value : null;
    }
    mapPaymentLink(obj) {
        const id = this.pickString(obj, 'id');
        if (!id)
            return null;
        return {
            id,
            title: this.pickString(obj, 'title') ?? undefined,
            description: (this.pickString(obj, 'description') ?? undefined),
            amount: this.pickNumber(obj, 'amount') ?? undefined,
            maxInstallments: this.pickNumber(obj, 'maxInstallments') ?? undefined,
            isActive: this.pickBoolean(obj, 'isActive') ?? undefined,
            code: this.pickString(obj, 'code') ?? undefined,
            createdAt: this.pickString(obj, 'createdAt') ?? undefined,
        };
    }
    mapPlan(obj) {
        const id = this.pickString(obj, 'id');
        if (!id)
            return null;
        return {
            id,
            price: this.pickNumber(obj, 'price') ?? undefined,
            description: this.pickString(obj, 'description') ?? undefined,
            frequency_type: (this.pickString(obj, 'frequency_type') ?? undefined),
            webhookUrl: this.pickString(obj, 'webhookUrl'),
            redirectUrl: this.pickString(obj, 'redirectUrl'),
            createdAt: this.pickString(obj, 'createdAt') ?? undefined,
        };
    }
    mapSubscription(obj) {
        const id = this.pickString(obj, 'id');
        if (!id)
            return null;
        const customer = this.getObject(obj?.customer);
        return {
            id,
            status: this.pickString(obj, 'status') ?? undefined,
            expiresAt: this.pickString(obj, 'expiresAt'),
            planId: this.pickString(obj, 'planId'),
            customer: customer
                ? {
                    name: this.pickString(customer, 'name') ?? undefined,
                    email: this.pickString(customer, 'email') ?? undefined,
                    document: this.pickString(customer, 'document') ?? undefined,
                    phone: this.pickString(customer, 'phone') ?? undefined,
                }
                : undefined,
            createdAt: this.pickString(obj, 'createdAt') ?? undefined,
        };
    }
    async createPaymentLink(domToken, input) {
        const url = `${this.baseUrl}/payment-links`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.post(url, input, {
            headers: { 'x-access-token': domToken },
        }));
        const root = this.getObject(res.data);
        const payload = this.getObject(root?.data ?? root);
        const mapped = this.mapPaymentLink(payload);
        if (!mapped)
            throw new Error('api-dom create payment link response invalid');
        return mapped;
    }
    async listPaymentLinks(domToken, input) {
        const url = `${this.baseUrl}/payment-links`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.get(url, {
            headers: { 'x-access-token': domToken },
            params: {
                page: input.page,
                pageSize: input.pageSize,
            },
        }));
        const root = this.getObject(res.data);
        const payload = this.getObject(root?.data ?? root);
        const arr = this.getArray(payload?.items ?? payload?.data ?? payload);
        const items = (arr ?? [])
            .map((x) => this.mapPaymentLink(this.getObject(x)))
            .filter((x) => Boolean(x));
        const total = this.pickNumber(payload, 'total') ??
            this.pickNumber(root, 'total') ??
            this.pickNumber(payload, 'count') ??
            undefined;
        return { items, total };
    }
    async getPaymentLink(domToken, id) {
        const url = `${this.baseUrl}/payment-links/${id}`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.get(url, {
            headers: { 'x-access-token': domToken },
        }));
        const root = this.getObject(res.data);
        const payload = this.getObject(root?.data ?? root);
        const mapped = this.mapPaymentLink(payload);
        if (!mapped)
            throw new Error('api-dom get payment link response invalid');
        return mapped;
    }
    async updatePaymentLink(domToken, id, input) {
        const url = `${this.baseUrl}/payment-links/${id}`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.put(url, input, {
            headers: { 'x-access-token': domToken },
        }));
        const root = this.getObject(res.data);
        const payload = this.getObject(root?.data ?? root);
        const mapped = this.mapPaymentLink(payload);
        if (!mapped)
            throw new Error('api-dom update payment link response invalid');
        return mapped;
    }
    async deletePaymentLink(domToken, id) {
        const url = `${this.baseUrl}/payment-links/${id}`;
        await (0, rxjs_1.firstValueFrom)(this.http.delete(url, {
            headers: { 'x-access-token': domToken },
        }));
    }
    async createPlan(domToken, input) {
        const url = `${this.baseUrl}/payments/pix-plan`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.post(url, input, {
            headers: { 'x-access-token': domToken },
        }));
        const root = this.getObject(res.data);
        const payload = this.getObject(root?.data ?? root);
        const mapped = this.mapPlan(payload);
        if (!mapped)
            throw new Error('api-dom create plan response invalid');
        return mapped;
    }
    async listPlans(domToken) {
        const url = `${this.baseUrl}/payments/pix-plan`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.get(url, {
            headers: { 'x-access-token': domToken },
        }));
        const root = this.getObject(res.data);
        const payload = this.getObject(root?.data ?? root);
        const arr = this.getArray(payload?.items ?? payload?.data ?? payload);
        return (arr ?? [])
            .map((x) => this.mapPlan(this.getObject(x)))
            .filter((x) => Boolean(x));
    }
    async deletePlan(domToken, id) {
        const url = `${this.baseUrl}/payments/pix-plan/${id}`;
        await (0, rxjs_1.firstValueFrom)(this.http.delete(url, {
            headers: { 'x-access-token': domToken },
        }));
    }
    async listSubscriptions(domToken, input) {
        const url = `${this.baseUrl}/subscription`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.get(url, {
            headers: { 'x-access-token': domToken },
            params: {
                page: input.page,
                pageSize: input.pageSize,
            },
        }));
        const root = this.getObject(res.data);
        const payload = this.getObject(root?.data ?? root);
        const arr = this.getArray(payload?.items ?? payload?.data ?? payload);
        const items = (arr ?? [])
            .map((x) => this.mapSubscription(this.getObject(x)))
            .filter((x) => Boolean(x));
        const total = this.pickNumber(payload, 'total') ??
            this.pickNumber(root, 'total') ??
            this.pickNumber(payload, 'count') ??
            undefined;
        return { items, total };
    }
    async cancelSubscription(domToken, id) {
        const url = `${this.baseUrl}/subscription/${id}/cancel`;
        await (0, rxjs_1.firstValueFrom)(this.http.put(url, undefined, {
            headers: { 'x-access-token': domToken },
        }));
    }
    async getMonthlyRevenue(domToken) {
        const url = `${this.baseUrl}/payments/monthly-revenue`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.get(url, { headers: { 'x-access-token': domToken } }));
        const root = this.getObject(res.data);
        const payload = this.getObject(root?.data ?? root);
        const arr = this.getArray(payload?.items ?? payload?.data ?? payload);
        const items = (arr ?? [])
            .map((x) => {
            const o = this.getObject(x);
            if (!o)
                return null;
            const date = this.pickString(o, 'date');
            const value = this.pickNumber(o, 'value');
            if (!date || value == null)
                return null;
            return { date, value };
        })
            .filter((x) => Boolean(x));
        return { items };
    }
    async getTaxes(masterKey) {
        const url = `${this.baseUrl}/payments/taxes`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.get(url, { headers: { 'x-access-token': masterKey } }));
        const root = this.getObject(res.data);
        const payload = this.getObject(root?.data ?? root);
        return payload;
    }
    async requestWithdraw(domToken, input) {
        const url = `${this.baseUrl}/payments/withdraw`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.post(url, { amount: input.amount, pixKey: input.pixKey }, { headers: { 'x-access-token': domToken } }));
        const root = this.getObject(res.data);
        const payload = this.getObject(root?.data ?? root);
        const requestId = this.pickString(payload, 'requestId') ??
            this.pickString(payload, 'id') ??
            this.pickString(root, 'requestId');
        const fee = this.pickNumber(payload, 'fee') ?? this.pickNumber(root, 'fee');
        const netAmount = this.pickNumber(payload, 'netAmount') ??
            this.pickNumber(root, 'netAmount');
        const totalAmount = this.pickNumber(payload, 'totalAmount') ??
            this.pickNumber(root, 'totalAmount');
        const message = this.pickString(payload, 'message') ?? this.pickString(root, 'message');
        if (!requestId || fee == null || netAmount == null || totalAmount == null) {
            throw new Error('api-dom request withdraw response invalid');
        }
        return {
            requestId,
            fee,
            netAmount,
            totalAmount,
            message: message ?? undefined,
        };
    }
    async listDomTransactions(domToken, input) {
        const url = `${this.baseUrl}/payments/dom/transactions`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.get(url, {
            headers: { 'x-access-token': domToken },
            params: { page: input.page, limit: input.limit, per_page: input.limit },
        }));
        const root = this.getObject(res.data);
        const arr = this.getArray(root?.transactions) ??
            this.getArray(root?.data) ??
            this.getArray(root) ??
            [];
        const rawObjects = arr
            .map((x) => this.getObject(x))
            .filter((x) => Boolean(x));
        if (rawObjects.length > 0) {
            console.log('[DOM List] First raw transaction keys:', Object.keys(rawObjects[0]));
            console.log('[DOM List] First raw transaction mdr_value:', rawObjects[0]['mdr_value']);
            console.log('[DOM List] First raw transaction id:', rawObjects[0]['id']);
            console.log('[DOM List] First raw transaction order_id:', rawObjects[0]['order_id']);
            console.log('[DOM List] First raw transaction cod_external:', rawObjects[0]['cod_external']);
            console.log('[DOM List] First raw transaction id_transaction:', rawObjects[0]['id_transaction']);
        }
        const transactions = rawObjects
            .map((x) => ({
            id: this.pickString(x, 'id') ?? '',
            order_id: this.pickString(x, 'order_id'),
            cod_external: this.pickString(x, 'cod_external'),
            created_at: this.pickString(x, 'created_at') ?? new Date().toISOString(),
            updated_at: this.pickString(x, 'updated_at'),
            amount: this.pickNumber(x, 'amount') ?? 0,
            liquid_amount: this.pickNumber(x, 'liquid_amount') ?? 0,
            mdr_value: this.pickNumber(x, 'mdr_value'),
            status: this.pickString(x, 'status') ?? 'pending',
            status_details: this.pickString(x, 'status_details'),
            payment_method: this.pickString(x, 'payment_method') ?? 'pix',
            installments: this.pickNumber(x, 'installments') ?? 1,
            card_bin: this.pickString(x, 'card_bin'),
            card_brand: this.pickString(x, 'card_brand'),
            pix_qrcode: this.pickString(x, 'pix_qrcode'),
            pix_content: this.pickString(x, 'pix_content'),
            pix_expire: this.pickString(x, 'pix_expire'),
            customer_name: this.pickString(x, 'customer_name'),
            customer_document: this.pickString(x, 'customer_document'),
            customer_email: this.pickString(x, 'customer_email'),
            customer_phone: this.pickString(x, 'customer_phone'),
            product_first: this.pickString(x, 'product_first'),
        }))
            .filter((x) => x.id.length > 0);
        const total = this.pickNumber(root, 'total') ??
            this.pickNumber(root, 'count') ??
            undefined;
        const lastPage = this.pickNumber(root, 'last_page') ??
            this.pickNumber(root, 'pages') ??
            undefined;
        return {
            transactions,
            total: total ?? undefined,
            last_page: lastPage ?? undefined,
        };
    }
    async createLead(data) {
        const masterKey = process.env.API_DOM_MASTER_KEY ?? 'MASTER_KEY_DOM_API';
        const url = `${this.baseUrl}/leads`;
        const res = await (0, rxjs_1.firstValueFrom)(this.http.post(url, data, {
            headers: { 'x-access-token': masterKey },
        }));
        return res.data;
    }
    async getDomTransactionDetail(domToken, id) {
        const domApiToken = process.env.DOM_TOKEN;
        if (domApiToken) {
            const realUrl = `${this.domRealApiUrl}/transactions/${id}`;
            try {
                console.log(`[DOM Client] GET ${realUrl} (real API)`);
                const res = await (0, rxjs_1.firstValueFrom)(this.http.get(realUrl, {
                    headers: { Authorization: `Bearer ${domApiToken}` },
                }));
                const data = this.getObject(res.data);
                if (data) {
                    const normalized = this.normalizeDomApiResponse(data);
                    if (normalized?.order) {
                        console.log(`[DOM Client] Success from real DOM API: ${realUrl}`);
                        return normalized;
                    }
                }
            }
            catch (err) {
                console.log(`[DOM Client] ${realUrl} → ${err?.response?.status ?? err?.message}`);
            }
        }
        const fallbackEndpoints = [
            `${this.baseUrl}/payments/dom/transactions/${id}`,
        ];
        for (const url of fallbackEndpoints) {
            try {
                console.log(`[DOM Client] GET ${url}`);
                const res = await (0, rxjs_1.firstValueFrom)(this.http.get(url, {
                    headers: { 'x-access-token': domToken },
                }));
                if (res.data?.status === 'OK' || res.data?.order || res.data?.id) {
                    console.log(`[DOM Client] Success from ${url}`);
                    return res.data;
                }
            }
            catch (err) {
                console.log(`[DOM Client] ${url} → ${err?.response?.status ?? err?.message}`);
            }
        }
        throw new Error(`Transaction ${id} not found in any Dom endpoint`);
    }
};
exports.ApiDomClient = ApiDomClient;
exports.ApiDomClient = ApiDomClient = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [axios_1.HttpService])
], ApiDomClient);
//# sourceMappingURL=api-dom.client.js.map