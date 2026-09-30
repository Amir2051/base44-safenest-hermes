import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Shield, CheckCircle, Loader2, Gift, Users, Sparkles, ArrowRight
} from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { toast } from "sonner";

export default function Onboarding() {
  const [user, setUser] = useState(null);
  const [step, setStep] = useState(1);
  const [referralCode, setReferralCode] = useState('');
  const [validatingCode, setValidatingCode] = useState(false);
  const [codeValid, setCodeValid] = useState(null);
  const [referrerName, setReferrerName] = useState('');

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const init = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
        
        // Skip onboarding if already completed
        if (userData.onboarding_completed) {
          navigate(createPageUrl('Dashboard'));
          return;
        }
        
        // Check sessionStorage first (from landing page or ReferralCodeHandler)
        const pendingCode = sessionStorage.getItem('pending_referral_code');
        if (pendingCode) {
          setReferralCode(pendingCode.toUpperCase());
          validateReferralCode(pendingCode);
          sessionStorage.removeItem('pending_referral_code');
        } else {
          // Check URL for referral code
          const urlParams = new URLSearchParams(window.location.search);
          const refCode = urlParams.get('ref');
          if (refCode) {
            setReferralCode(refCode.toUpperCase());
            validateReferralCode(refCode);
          }
        }
      } catch (error) {
        // Not authenticated, redirect to login
        console.error('Auth error:', error);
        
        // Preserve referral code through login
        const urlParams = new URLSearchParams(window.location.search);
        const refCode = urlParams.get('ref');
        if (refCode) {
          sessionStorage.setItem('pending_referral_code', refCode.toUpperCase());
        }
        
        base44.auth.redirectToLogin(window.location.pathname + window.location.search);
      }
    };

    init();
  }, [navigate]);

  const validateReferralCode = async (code) => {
    if (!code || code.length < 4) {
      setCodeValid(null);
      setReferrerName('');
      return;
    }

    setValidatingCode(true);
    
    try {
      const response = await base44.functions.invoke('referralService', {
        endpoint: 'validate-code',
        code: code.toUpperCase()
      });

      if (response.data.valid) {
        setCodeValid(true);
        setReferrerName(response.data.referrer_name);
        toast.success(`✅ Valid referral code from ${response.data.referrer_name}!`);
      } else {
        setCodeValid(false);
        setReferrerName('');
        toast.error(response.data.error || 'Invalid referral code');
      }
    } catch (error) {
      setCodeValid(false);
      setReferrerName('');
      console.error('Validate code error:', error);
    } finally {
      setValidatingCode(false);
    }
  };

  const applyReferralMutation = useMutation({
    mutationFn: async () => {
      if (!referralCode) {
        return { success: true, skipped: true };
      }

      const response = await base44.functions.invoke('referralService', {
        endpoint: 'apply-signup',
        referral_code: referralCode.toUpperCase()
      });

      return response.data;
    },
    onSuccess: (data) => {
      if (data.skipped) {
        // No referral code
        completeOnboarding();
      } else {
        // Referral applied — track signup event
        trackEvent('signup', { event_category: 'onboarding' });
        // Referral applied
        queryClient.invalidateQueries({ queryKey: ['user'] });
        toast.success('🎁 ' + data.message, { duration: 8000 });
        setStep(3); // Success step
      }
    },
    onError: (error) => {
      toast.error('Failed to apply referral: ' + error.message);
    }
  });

  const completeOnboarding = async () => {
    try {
      await base44.auth.updateMe({
        onboarding_completed: true
      });
      
      toast.success('Welcome to SafeNest! 🎉');
      navigate(createPageUrl('Dashboard'));
    } catch (error) {
      console.error('Complete onboarding error:', error);
      toast.error('Failed to complete onboarding');
    }
  };

  const handleNext = () => {
    if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      applyReferralMutation.mutate();
    }
  };

  const handleSkip = () => {
    applyReferralMutation.mutate();
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0f1419]">
        <Loader2 className="w-12 h-12 text-cyan-400 animate-spin" />
      </div>
    );
  }

  const progress = (step / 3) * 100;

  return (
    <div className="min-h-screen bg-[#0f1419] flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-cyan-500/30">
            <Shield className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">
            Welcome to SafeNest!
          </h1>
          <p className="text-gray-400">
            Let's get you started with world-class security
          </p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between mt-2 text-xs text-gray-400">
            <span className={step >= 1 ? 'text-cyan-400' : ''}>Welcome</span>
            <span className={step >= 2 ? 'text-cyan-400' : ''}>Referral Code</span>
            <span className={step >= 3 ? 'text-cyan-400' : ''}>Complete</span>
          </div>
        </div>

        {/* Step 1: Welcome */}
        {step === 1 && (
          <Card className="bg-gradient-to-br from-[#1a2332] to-[#0f1419] border-cyan-500/30">
            <CardHeader>
              <CardTitle className="text-white text-2xl">
                🎉 Account Created Successfully!
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-cyan-500/10 rounded-lg border border-cyan-500/20">
                  <Shield className="w-8 h-8 text-cyan-400 mb-3" />
                  <p className="text-white font-semibold mb-1">Title Protection</p>
                  <p className="text-gray-400 text-sm">AI-powered property monitoring</p>
                </div>
                
                <div className="p-4 bg-purple-500/10 rounded-lg border border-purple-500/20">
                  <Sparkles className="w-8 h-8 text-purple-400 mb-3" />
                  <p className="text-white font-semibold mb-1">Legal AI Assistant</p>
                  <p className="text-gray-400 text-sm">24/7 legal support</p>
                </div>
                
                <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/20">
                  <CheckCircle className="w-8 h-8 text-green-400 mb-3" />
                  <p className="text-white font-semibold mb-1">Identity Monitor</p>
                  <p className="text-gray-400 text-sm">Dark web scanning</p>
                </div>
              </div>

              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <p className="text-green-300 text-sm">
                  ✅ <strong>All features are 100% FREE!</strong> No credit card required.
                </p>
              </div>

              <Button
                onClick={handleNext}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 h-12 text-lg"
              >
                Continue
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Referral Code */}
        {step === 2 && (
          <Card className="bg-gradient-to-br from-[#1a2332] to-[#0f1419] border-purple-500/30">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Gift className="w-6 h-6 text-purple-400" />
                Do You Have a Referral Code?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-6 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-lg border border-purple-500/30">
                <div className="flex items-start gap-3">
                  <Users className="w-10 h-10 text-purple-400 flex-shrink-0" />
                  <div>
                    <h3 className="text-white font-bold text-lg mb-2">
                      Get 1 Month FREE Premium!
                    </h3>
                    <ul className="text-purple-300 text-sm space-y-1">
                      <li>✨ Full access to all premium features</li>
                      <li>🚀 Priority support</li>
                      <li>🎁 No credit card required</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-gray-300 mb-2 block">
                  Referral Code (Optional)
                </Label>
                <div className="relative">
                  <Input
                    value={referralCode}
                    onChange={(e) => {
                      const value = e.target.value.toUpperCase();
                      setReferralCode(value);
                      if (value.length >= 4) {
                        validateReferralCode(value);
                      } else {
                        setCodeValid(null);
                      }
                    }}
                    placeholder="Enter code (e.g., ABC1234)"
                    className="bg-[#0f1419] border-purple-500/20 text-white uppercase h-12 pr-12"
                    maxLength={10}
                  />
                  {validatingCode && (
                    <Loader2 className="absolute right-3 top-3 w-6 h-6 text-purple-400 animate-spin" />
                  )}
                  {!validatingCode && codeValid === true && (
                    <CheckCircle className="absolute right-3 top-3 w-6 h-6 text-green-400" />
                  )}
                </div>
                
                {codeValid === true && referrerName && (
                  <div className="mt-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <p className="text-green-300 text-sm">
                      ✅ Valid code from <strong>{referrerName}</strong>! 
                      You'll get 1 month FREE and they'll get bonus months too!
                    </p>
                  </div>
                )}
                
                {codeValid === false && (
                  <p className="mt-2 text-red-400 text-sm">
                    Invalid referral code. Please check and try again.
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleSkip}
                  variant="outline"
                  className="flex-1 border-gray-500/20 h-12"
                  disabled={applyReferralMutation.isPending}
                >
                  Skip
                </Button>
                <Button
                  onClick={handleNext}
                  disabled={applyReferralMutation.isPending || (referralCode && !codeValid)}
                  className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 h-12"
                >
                  {applyReferralMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Applying...
                    </>
                  ) : referralCode ? (
                    'Apply Code'
                  ) : (
                    'Continue'
                  )}
                </Button>
              </div>

              <p className="text-center text-xs text-gray-500">
                Don't have a code? No problem! You can still use all free features.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Success */}
        {step === 3 && (
          <Card className="bg-gradient-to-br from-[#1a2332] to-[#0f1419] border-green-500/30">
            <CardContent className="p-12 text-center">
              <div className="w-24 h-24 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
                <CheckCircle className="w-12 h-12 text-white" />
              </div>
              
              <h2 className="text-3xl font-bold text-white mb-3">
                🎉 You're All Set!
              </h2>
              
              <div className="mb-6">
                <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-lg px-6 py-2">
                  1 Month FREE Premium Access!
                </Badge>
              </div>
              
              <p className="text-gray-300 mb-8">
                {referrerName && (
                  <>Thanks to <strong className="text-green-400">{referrerName}</strong>, you now have full access to all premium features!</>
                )}
              </p>

              <Button
                onClick={completeOnboarding}
                className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 h-12 px-8 text-lg"
              >
                Go to Dashboard
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-gray-500 text-sm">
            Need help? <a href="#" className="text-cyan-400 hover:underline">Contact Support</a>
          </p>
        </div>
      </div>
    </div>
  );
}