# HDFC SmartGateway — Feature Activation Request

**Merchant ID:** SG4547  
**Environment:** UAT Sandbox (`smartgateway.hdfcuat.bank.in`)  
**Date:** 25-Feb-2026  

---

## Features to Enable on Juspay/HDFC Dashboard

The following features have been **integrated in our codebase** and are ready, but they need to be **enabled at the merchant level** in the HDFC SmartGateway / Juspay Dashboard before they will work.

| # | Feature | Dashboard Setting | Documentation |
|---|---------|------------------|---------------|
| 1 | **Payment Locking** | Enable `payment_filter` support for merchant | [Docs](https://docs.hdfcbank.juspay.in/docs/hdfc-resources/docs/common-resources/payment-locking) |
| 2 | **Surcharge / Convenience Fee** | Enable surcharge configuration (flat fee / percentage) | [Docs](https://docs.hdfcbank.juspay.in/docs/surcharge-hdfc/docs/overview/overview) |
| 3 | **UPI Autopay (Mandates)** | Enable mandate/subscription support | [Docs](https://docs.hdfcbank.juspay.in/docs/smartgateway-api-ref-basicauth/docs/mandates-subscriptions/introduction) |
| 4 | **One-Time Mandate (OTM)** | Enable OTM for UPI recurring payments | [Docs](https://docs.hdfcbank.juspay.in/docs/smartgateway-tranportal-integration/docs/tranportal-integration/one-time-mandate) |
| 5 | **Native OTP** | Enable native OTP handling (client-side OTP) | [Docs](https://docs.hdfcbank.juspay.in/docs/smartgateway-tranportal-integration/docs/native-otp/native-otp-introduction) |
| 6 | **CVV-less Payments** | Enable card tokenization & `save_to_locker` | [Docs](https://docs.hdfcbank.juspay.in/docs/hdfc-resources/docs/card-network-tokenization/cvvless-payments) |
| 7 | **Dynamic Currency Conversion (DCC)** | Enable DCC for international card transactions | [Docs](https://docs.hdfcbank.juspay.in/docs/dcc-hdfc/docs/overview/dcc) |
| 8 | **Offers Engine** | Enable offer campaigns & discount codes | [Docs](https://docs.hdfcbank.juspay.in/docs/offer-engine-hdfc/docs/offer-engine/overview) |

---

## What We've Verified

- ✅ Standard payment flow (order creation → payment page → redirect → status) is **working perfectly**.
- ✅ API authentication (Basic Auth) is **working**.
- ✅ Webhook endpoint for payment status updates is **ready**.
- ✅ All 8 advanced features above are **coded and sending correct API parameters**.
- ❌ Advanced features are **not reflecting on the payment page** because they are not enabled on the merchant account.

## How We Confirmed This

We tested by sending a `payment_filter` parameter (to hide the Wallet payment method) **directly via API** to the HDFC UAT endpoint — bypassing our application entirely. The Wallet option was still visible on the payment page, confirming the feature is **disabled at the account level**.

## Action Required

Please request the HDFC SmartGateway / Juspay team to **enable the above 8 features** on Merchant ID **SG4547** in the **UAT sandbox environment**. Once enabled, our integration will work immediately — no code changes needed.

---

**Contact:** HDFC SmartGateway Support / Juspay Integration Team
