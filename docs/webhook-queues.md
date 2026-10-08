# Webhook queues

Webhook consumers use RabbitMQ through `RABBITMQ_URL` (local default: `amqp://localhost:5672`). The deployment Compose file includes a persistent RabbitMQ service; set `RABBITMQ_PASSWORD` to a strong URL-safe password before starting it. No broker port is exposed externally.

Queues and messages are durable/persistent. HTTP handlers wait for publisher confirmation, with a 10-second publication timeout. Consumers acknowledge only after processing succeeds. Connection setup restores queues and consumers on reconnect. Each queue uses prefetch 1 to preserve transaction ordering; Zero Grau notifications run in `zero-grau-payment-notifications`, separately from DOM persistence.

Failed processing is retried up to three attempts, then retained in `<queue>.failed`. Inspect and fix the underlying failure before manually replaying messages. Failed/unprocessed webhook event records can be resumed; processed signatures remain idempotent. Notification requests time out after five seconds. Missing notification configuration skips delivery as before.

SIM Delivery polls pending PIX payments every five seconds, skipping overlapping reconciliation runs. Both storefronts check pending PIX status every five seconds. These checks do not guarantee confirmation within five seconds: merchant-scoped SIM Delivery checks still read SimIntPay's local status and depend on DOM webhook arrival.
