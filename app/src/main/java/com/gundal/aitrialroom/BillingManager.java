package com.gundal.aitrialroom;

import android.app.Activity;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONObject;

import java.util.Collections;
import java.util.List;

/**
 * Google Play subscription: 1 month free trial, then ₹365 per year.
 * Play Console setup: subscription product "ai_trialroom_yearly", base plan "yearly-365" (1 year, ₹365, auto-renewing),
 * offer "free-month" (free trial, 1 month, new customers only).
 */
public class BillingManager implements PurchasesUpdatedListener {
    static final String PRODUCT_ID = "ai_trialroom_yearly";

    private final Activity activity;
    private final BillingClient client;
    private volatile String state = "loading";      // loading | active | pending | none | unavailable | error
    private volatile String price = "";             // e.g. "₹365.00"
    private volatile String trial = "";             // e.g. "P1M" when a free trial is offered to this user
    private volatile String message = "";
    private volatile ProductDetails details;
    private volatile String offerToken;

    BillingManager(Activity a) {
        activity = a;
        client = BillingClient.newBuilder(a)
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .enableAutoServiceReconnection()
                .build();
        connect();
    }

    private void connect() {
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult r) {
                if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    loadProduct();
                    refresh();
                } else {
                    state = r.getResponseCode() == BillingClient.BillingResponseCode.BILLING_UNAVAILABLE ? "unavailable" : "error";
                    message = r.getDebugMessage();
                }
            }

            @Override
            public void onBillingServiceDisconnected() { /* auto reconnection is enabled */ }
        });
    }

    private void loadProduct() {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(PRODUCT_ID)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()))
                .build();
        client.queryProductDetailsAsync(params, (r, result) -> {
            List<ProductDetails> list = result == null ? null : result.getProductDetailsList();
            if (r.getResponseCode() != BillingClient.BillingResponseCode.OK || list == null || list.isEmpty()) {
                message = "Subscription not found in Google Play yet";
                return;
            }
            ProductDetails pd = list.get(0);
            List<ProductDetails.SubscriptionOfferDetails> offers = pd.getSubscriptionOfferDetails();
            if (offers == null || offers.isEmpty()) return;
            ProductDetails.SubscriptionOfferDetails chosen = offers.get(0);
            String trialPeriod = "";
            // Play only returns offers this user is eligible for: prefer the one with a free phase (the free month)
            for (ProductDetails.SubscriptionOfferDetails o : offers) {
                for (ProductDetails.PricingPhase ph : o.getPricingPhases().getPricingPhaseList()) {
                    if (ph.getPriceAmountMicros() == 0) { chosen = o; trialPeriod = ph.getBillingPeriod(); break; }
                }
                if (!trialPeriod.isEmpty()) break;
            }
            List<ProductDetails.PricingPhase> phases = chosen.getPricingPhases().getPricingPhaseList();
            price = phases.get(phases.size() - 1).getFormattedPrice();
            trial = trialPeriod;
            offerToken = chosen.getOfferToken();
            details = pd;
        });
    }

    /** Re-reads the user's subscriptions from Google Play (also used for "Restore purchase"). */
    void refresh() {
        if (!client.isReady()) return;   // the first check runs as soon as the connection is ready
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
                (r, purchases) -> {
                    if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) handle(purchases);
                    else { message = r.getDebugMessage(); if ("loading".equals(state)) state = "error"; }
                });
    }

    private void handle(List<Purchase> purchases) {
        boolean active = false, pending = false;
        if (purchases != null) {
            for (Purchase p : purchases) {
                if (!p.getProducts().contains(PRODUCT_ID)) continue;
                if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                    active = true;
                    if (!p.isAcknowledged()) {
                        client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(), ar -> { });
                    }
                } else if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) {
                    pending = true;
                }
            }
        }
        state = active ? "active" : pending ? "pending" : "none";
    }

    void buy() {
        final ProductDetails pd = details;
        final String token = offerToken;
        if (pd == null || token == null) {
            message = "Google Play is not ready yet. Please check your internet and try again.";
            loadProduct();
            return;
        }
        final BillingFlowParams params = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(pd)
                        .setOfferToken(token)
                        .build()))
                .build();
        activity.runOnUiThread(() -> {
            BillingResult r = client.launchBillingFlow(activity, params);
            if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) message = r.getDebugMessage();
        });
    }

    @Override
    public void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
        int code = r.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK) handle(purchases);
        else if (code == BillingClient.BillingResponseCode.USER_CANCELED) message = "cancelled";
        else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) refresh();
        else message = r.getDebugMessage();
    }

    String statusJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("state", state);
            o.put("price", price);
            o.put("trial", trial);
            o.put("message", message == null ? "" : message);
            o.put("ready", details != null);
        } catch (Exception ignored) { }
        message = "";
        return o.toString();
    }

    void end() {
        try { client.endConnection(); } catch (Exception ignored) { }
    }
}
