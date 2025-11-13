package org.outline.client;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.BridgeActivity;
import org.outline.CapacitorPluginOutline;

public class MainActivity extends BridgeActivity {
  private static final String TAG = "OutlineMainActivity";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    try {
      registerPlugin(CapacitorPluginOutline.class);
    } catch (Exception e) {
    }
    super.onCreate(savedInstanceState);
  }

  @Override
  public void onResume() {
    super.onResume();
    new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
      @Override
      public void run() {
        setupExternalLinkHandling();
      }
    }, 2000);
  }

  private void setupExternalLinkHandling() {
    if (getBridge() == null) {
      new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
        @Override
        public void run() {
          setupExternalLinkHandling();
        }
      }, 1000);
      return;
    }

    WebView webView = getBridge().getWebView();
    if (webView == null) {
      new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
        @Override
        public void run() {
          setupExternalLinkHandling();
        }
      }, 1000);
      return;
    }

    webView.post(new Runnable() {
      @Override
      public void run() {
        WebView currentWebView = getBridge().getWebView();
        if (currentWebView != null && currentWebView.getUrl() != null) {
          try {
            WebViewClient existingClient = currentWebView.getWebViewClient();
            if (existingClient != null) {
              ExternalLinkWebViewClient wrapper = new ExternalLinkWebViewClient(existingClient);
              currentWebView.setWebViewClient(wrapper);
            }
          } catch (Exception e) {
          }
        } else {
          setupExternalLinkHandling();
        }
      }
    });
  }

  private class ExternalLinkWebViewClient extends WebViewClient {
    private final WebViewClient originalClient;

    public ExternalLinkWebViewClient(WebViewClient originalClient) {
      this.originalClient = originalClient;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
      if (handleExternalLink(url)) {
        return true;
      }
      return originalClient.shouldOverrideUrlLoading(view, url);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
        String url = request.getUrl().toString();
        if (handleExternalLink(url)) {
          return true;
        }
        return originalClient.shouldOverrideUrlLoading(view, request);
      }
      return false;
    }

    @Override
    public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
      originalClient.onPageStarted(view, url, favicon);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
      originalClient.onPageFinished(view, url);
    }

    @Override
    public void onReceivedError(WebView view, android.webkit.WebResourceRequest request, android.webkit.WebResourceError error) {
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
        originalClient.onReceivedError(view, request, error);
      }
    }
  }

  private boolean handleExternalLink(String url) {
    if (url == null) {
      return false;
    }

    Uri uri = Uri.parse(url);
    String scheme = uri.getScheme();
    String host = uri.getHost();

    boolean isHttpHttps = "http".equals(scheme) || "https".equals(scheme);
    boolean isLocalhost = "localhost".equals(host) || "127.0.0.1".equals(host);
    boolean isCapacitor = "capacitor".equals(scheme) || "ionic".equals(scheme);
    boolean isExternalLink = isHttpHttps && !isLocalhost && !isCapacitor;

    if (isExternalLink) {
      Intent intent = new Intent(Intent.ACTION_VIEW, uri);
      startActivity(intent);
      return true;
    }

    return false;
  }
}
