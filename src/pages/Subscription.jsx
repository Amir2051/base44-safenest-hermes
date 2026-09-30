import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shield, CheckCircle, Sparkles, CreditCard, Clock,
  Lock, Zap, TrendingUp, Users, Star, ExternalLink, AlertTriangle
} from "lucide-react";
import { toast } from "sonner";

import { trackEvent } from "@/lib/analytics";

const STRIPE_MONTHLY_URL = "https://buy.stripe.com/9B6cMY2jw0Ia3I7feh4gg0b";
const STRIPE_YEARLY_URL = "https://buy.stripe.com/3cI14g9LY2Qi1zZ1nr4gg0c";

export default function Subscription() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingCyber, setLoadingCyber] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: subscriptionInfo } = useQuery({
    queryKey: ['subscription-info'],
    queryFn: async () => {
      const response = await base44.functions.invoke('subscriptionService', {
        endpoint: 'get-subscription-info'
      });
      return response.data;
    },
    enabled: !!user,
    refetchInterval: 30000
  });

  const handleSubscribe = (url) => {
    setLoading(true);
    trackEvent('subscription_started', { event_category: 'subscription' });
    const finalUrl = user 
      ? `${url}?prefilled_email=${encodeURIComponent(user.email)}&client_reference_id=${user.id}`
      : url;
    window.location.href = finalUrl;
  };

  const handleCyberMonday = () => {
    setLoadingCyber(true);
    // Append user info for webhook tracking
    const url = user 
      ? `${STRIPE_YEARLY_URL}?prefilled_email=${encodeURIComponent(user.email)}&client_reference_id=${user.id}`
      : STRIPE_YEARLY_URL;
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => setLoadingCyber(false), 1000);
  };

  // Stripe script removed as we are using direct link

  const handleCancelSubscription = async () => {
    setCancelling(true);
    try {
      const response = await base44.functions.invoke('subscriptionService', {
        endpoint: 'cancel-subscription'
      });
      toast.success(response.data.message);
      setShowCancelDialog(false);
      // Reload subscription info
      const subResponse = await base44.functions.invoke('subscriptionService', {
        endpoint: 'get-subscription-info'
      });
      window.location.reload();
    } catch (error) {
      toast.error('Failed to cancel: ' + error.message);
    } finally {
      setCancelling(false);
    }
  };

  const isSubscribed = subscriptionInfo?.subscription_status === 'active';
  const isOnTrial = subscriptionInfo?.is_trial_active;
  const isTrialCancelled = subscriptionInfo?.is_trial_cancelled;
  const trialStillActive = subscriptionInfo?.trial_still_active;
  const daysLeft = subscriptionInfo?.days_left || 0;
  const canCancel = (isOnTrial && !isTrialCancelled) || isSubscribed;

  return (
    <div className="min-h-screen p-6 lg:p-8 bg-gradient-to-br from-[#0a0a0a] via-[#0f1419] to-[#0a0a0a]">
      {/* Background Effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[120px] animate-pulse delay-1000" />
      </div>

      <div className="max-w-6xl mx-auto space-y-6 relative z-10">
        
        {/* Cyber Monday Banner */}
        {!isSubscribed && (
            <div className="bg-gradient-to-r from-purple-600 via-pink-600 to-red-600 rounded-2xl p-4 sm:p-6 md:p-8 text-center shadow-2xl border border-white/10 relative overflow-hidden group">
                <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />
                <div className="relative z-10 flex flex-col h-full">
                    <div className="mb-3">
                         <div className="inline-block bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-white font-bold text-xs sm:text-sm border border-white/30">
                            LIMITED TIME OFFER
                        </div>
                    </div>
                    
                    <h2 className="text-2xl sm:text-3xl md:text-5xl font-black text-white tracking-tight drop-shadow-lg break-words leading-tight mb-2">
                        Yearly Premium Deal
                    </h2>
                    
                    <p className="text-base sm:text-lg md:text-2xl text-white/90 font-medium max-w-3xl mx-auto leading-snug break-words mb-3">
                        Save big on your yearly SafeNestt subscription.
                    </p>
                    
                    <p className="text-white/80 text-xs sm:text-sm md:text-base max-w-2xl mx-auto break-words whitespace-normal leading-relaxed mb-6">
                        Unlock a full year of protection, case support, and scam prevention tools for a special yearly price. 
                        Subscribe now and secure faster case handling, priority assistance, and exclusive premium features. 
                        Secure your digital life with our best value plan.
                    </p>
                    
                    <div className="mt-auto flex justify-center w-full">
                        <Button 
                            onClick={handleCyberMonday}
                            disabled={loadingCyber}
                            size="lg"
                            className="w-full sm:w-auto bg-white text-purple-600 hover:bg-gray-100 hover:text-purple-700 font-bold text-base sm:text-lg px-6 sm:px-8 py-4 sm:py-6 rounded-full shadow-xl transform transition hover:scale-105 whitespace-normal h-auto min-h-[3rem]"
                        >
                            {loadingCyber ? <Clock className="w-5 h-5 animate-spin mr-2 flex-shrink-0" /> : <Sparkles className="w-5 h-5 mr-2 flex-shrink-0" />}
                            <span>Activate Yearly Premium</span>
                        </Button>
                    </div>
                </div>
            </div>
        )}

        {/* Header */}
        <div className="text-center py-4">
          <div className="flex flex-col md:flex-row items-center justify-center gap-3 mb-2">
            <Shield className="w-10 h-10 md:w-12 md:h-12 text-cyan-400" />
            <h1 className="text-3xl md:text-5xl font-bold text-white text-center">
              SafeNestt Premium
            </h1>
          </div>
          <p className="text-lg md:text-xl text-gray-300 max-w-lg mx-auto px-4">
            Complete protection for your digital life
          </p>
        </div>

        {/* Current Status Banner - Only show if subscribed or on trial */}
        {(isSubscribed || isOnTrial) && (
          <Card className={`bg-gradient-to-r ${
            isOnTrial ? 'from-cyan-500/10 to-blue-500/10 border-cyan-500/30' :
            'from-green-500/10 to-emerald-500/10 border-green-500/30'
          }`}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                  <div className={`w-16 h-16 rounded-xl flex items-center justify-center ${
                    isOnTrial ? 'bg-gradient-to-br from-cyan-500 to-blue-500' :
                    'bg-gradient-to-br from-green-500 to-emerald-500'
                  }`}>
                    {isOnTrial ? <Clock className="w-8 h-8 text-white" /> : <CheckCircle className="w-8 h-8 text-white" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-bold text-xl">
                        {isOnTrial ? '7-Day Free Trial Active' : 'Premium Subscription Active'}
                      </h3>
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/50">
                        ACTIVE
                      </Badge>
                    </div>
                    <p className="text-gray-300">
                      {isOnTrial ? (
                        <>🎁 {daysLeft} days remaining in your free trial</>
                      ) : (
                        <>✨ Next billing: {subscriptionInfo?.next_billing_date ? new Date(subscriptionInfo.next_billing_date).toLocaleDateString() : 'N/A'}</>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Pricing Card */}
        <Card className="bg-gradient-to-br from-[#1a2332] to-[#0f1419] border-cyan-500/30 relative overflow-hidden">
          {/* Glow Effect */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px]" />
          
          <CardContent className="p-4 md:p-8 lg:p-12 relative">
            <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
              {/* Left: Plan Details */}
              <div className="space-y-6">
                <div>
                  <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/50 mb-4 text-sm px-3 py-1">
                    MONTHLY PLAN
                  </Badge>
                  <h2 className="text-3xl sm:text-4xl md:text-6xl font-bold text-white mb-2 break-words">
                    $24.99<span className="text-lg md:text-2xl text-gray-400">/month</span>
                  </h2>
                  <p className="text-green-400 font-semibold text-lg md:text-xl flex items-center gap-2">
                    <Sparkles className="w-5 h-5 md:w-6 md:h-6 flex-shrink-0" />
                    Full Access • Cancel Anytime
                  </p>
                </div>

                <div className="p-4 md:p-5 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
                  <h3 className="text-white font-bold text-lg mb-2">What's Included</h3>
                  <p className="text-gray-300 text-sm md:text-base leading-relaxed">
                    SafeNestt Premium gives you full access to the investigation system, 
                    unlimited case tools, scam detection, wallet lookups, and priority security updates.
                    Protect your digital identity with advanced AI-powered security.
                  </p>
                </div>

                <div className="space-y-3">
                  {[
                    "Full blockchain investigation tools",
                    "Unlimited fraud case management",
                    "Real-time scam detection & wallet monitoring",
                    "AI-powered security advisor (Mia)",
                    "Priority support & security updates",
                    "Advanced VPN protection",
                    "Law enforcement report generation",
                    "Cancel anytime - no contracts"
                  ].map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                      <span className="text-white text-sm md:text-base">{feature}</span>
                    </div>
                  ))}
                </div>

                {/* Subscribe Buttons */}
                <div className="flex flex-col sm:flex-row gap-4">
                    <Button
                      onClick={() => handleSubscribe(STRIPE_MONTHLY_URL)} // Monthly
                      disabled={loading}
                      size="lg"
                      className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold py-6 shadow-lg shadow-cyan-500/30"
                    >
                      {loading ? (
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                      ) : (
                        <span className="flex flex-col items-center leading-tight">
                          <span className="text-lg">Monthly</span>
                          <span className="text-sm opacity-90">$24.99/mo</span>
                        </span>
                      )}
                    </Button>

                    <Button
                      onClick={() => handleSubscribe(STRIPE_YEARLY_URL)} // Yearly
                      disabled={loading}
                      size="lg"
                      variant="outline"
                      className="flex-1 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 font-bold py-6"
                    >
                      {loading ? (
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-cyan-400" />
                      ) : (
                        <span className="flex flex-col items-center leading-tight">
                          <span className="text-lg">Yearly</span>
                          <span className="text-sm opacity-90">$249.99/yr</span>
                        </span>
                      )}
                    </Button>
                </div>

                <p className="text-xs md:text-sm text-gray-400 text-center px-4">
                  Secure payment powered by Stripe • Opens in new window • Cancel anytime
                </p>
              </div>

              {/* Right: Feature Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card className="bg-[#0f1419] border-cyan-500/20 hover:border-cyan-500/40 transition-all h-full">
                  <CardContent className="p-4 md:p-6 text-center h-full flex flex-col justify-center">
                    <Shield className="w-10 h-10 md:w-12 md:h-12 text-cyan-400 mx-auto mb-3" />
                    <h3 className="text-white font-bold mb-1">24/7 Protection</h3>
                    <p className="text-gray-400 text-sm">Always-on security monitoring</p>
                  </CardContent>
                </Card>

                <Card className="bg-[#0f1419] border-purple-500/20 hover:border-purple-500/40 transition-all h-full">
                  <CardContent className="p-4 md:p-6 text-center h-full flex flex-col justify-center">
                    <Zap className="w-10 h-10 md:w-12 md:h-12 text-purple-400 mx-auto mb-3" />
                    <h3 className="text-white font-bold mb-1">Instant Alerts</h3>
                    <p className="text-gray-400 text-sm">Real-time threat notifications</p>
                  </CardContent>
                </Card>

                <Card className="bg-[#0f1419] border-green-500/20 hover:border-green-500/40 transition-all h-full">
                  <CardContent className="p-4 md:p-6 text-center h-full flex flex-col justify-center">
                    <TrendingUp className="w-10 h-10 md:w-12 md:h-12 text-green-400 mx-auto mb-3" />
                    <h3 className="text-white font-bold mb-1">Recovery Tools</h3>
                    <p className="text-gray-400 text-sm">Help recover stolen assets</p>
                  </CardContent>
                </Card>

                <Card className="bg-[#0f1419] border-orange-500/20 hover:border-orange-500/40 transition-all h-full">
                  <CardContent className="p-4 md:p-6 text-center h-full flex flex-col justify-center">
                    <Users className="w-10 h-10 md:w-12 md:h-12 text-orange-400 mx-auto mb-3" />
                    <h3 className="text-white font-bold mb-1">Expert Support</h3>
                    <p className="text-gray-400 text-sm">Priority customer service</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* FAQ Section */}
        <Card className="bg-gradient-to-br from-[#1a2332] to-[#0f1419] border-cyan-500/20">
          <CardHeader>
            <CardTitle className="text-white text-2xl">Frequently Asked Questions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="text-white font-bold mb-2">How does the 7-day free trial work?</h3>
              <p className="text-gray-300">
                Start your trial today with full access to all premium features. You won't be charged 
                for 7 days. After the trial, your subscription automatically continues at $24.99/month 
                unless you cancel.
              </p>
            </div>

            <div>
              <h3 className="text-white font-bold mb-2">Can I cancel anytime?</h3>
              <p className="text-gray-300">
                Yes! Cancel your subscription at any time with no penalties or fees. You'll continue 
                to have access until the end of your billing period.
              </p>
            </div>

            <div>
              <h3 className="text-white font-bold mb-2">What payment methods do you accept?</h3>
              <p className="text-gray-300">
                We accept all major credit and debit cards through our secure payment processor, Stripe.
              </p>
            </div>

            <div>
              <h3 className="text-white font-bold mb-2">Is my data secure?</h3>
              <p className="text-gray-300">
                Absolutely. We use bank-level encryption to protect your data. All payments are processed 
                securely through Stripe, and we never store your payment information.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Trust Indicators */}
        <div className="flex flex-wrap items-center justify-center gap-8 py-8">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-cyan-400" />
            <span className="text-gray-300">Secure Payments</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-cyan-400" />
            <span className="text-gray-300">Bank-Level Encryption</span>
          </div>
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-cyan-400" />
            <span className="text-gray-300">Trusted by Thousands</span>
          </div>
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      {showCancelDialog && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-6">
          <Card className="max-w-lg w-full bg-gradient-to-br from-[#1a2332] to-[#0f1419] border-red-500/30">
            <CardContent className="p-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                </div>
                <h3 className="text-white font-bold text-xl">Cancel Subscription?</h3>
              </div>
              
              <p className="text-gray-300 mb-6">
                {isOnTrial ? (
                  <>
                    Are you sure you want to cancel your subscription? You will lose access to all premium features after your free trial ends on{' '}
                    <span className="font-semibold text-white">
                      {subscriptionInfo?.trial_ends ? new Date(subscriptionInfo.trial_ends).toLocaleDateString() : 'N/A'}
                    </span>.
                  </>
                ) : (
                  'Are you sure you want to cancel your subscription? You will lose access to all premium features at the end of your billing period.'
                )}
              </p>

              {isOnTrial && (
                <div className="p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-lg mb-6">
                  <p className="text-cyan-400 text-sm">
                    ℹ️ You'll keep access until {subscriptionInfo?.trial_ends ? new Date(subscriptionInfo.trial_ends).toLocaleDateString() : 'N/A'}. No charges will occur.
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  onClick={() => setShowCancelDialog(false)}
                  variant="outline"
                  className="flex-1 border-gray-500/30"
                  disabled={cancelling}
                >
                  Keep Subscription
                </Button>
                <Button
                  onClick={handleCancelSubscription}
                  disabled={cancelling}
                  className="flex-1 bg-red-500 hover:bg-red-600"
                >
                  {cancelling ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Cancelling...
                    </>
                  ) : (
                    'Yes, Cancel'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}