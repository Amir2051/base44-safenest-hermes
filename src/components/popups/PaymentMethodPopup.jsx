import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";

const STORAGE_KEY = "safenestt_payment_dismissed";

function isDismissedThisSession() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function PaymentMethodPopup({ user, onUpdate }) {
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(false);

  if (!user) return null;

  const hasPaymentMethod = user.payment_method_added;
  // Only show if user doesn't have payment method AND hasn't dismissed it this session
  const shouldShow = !hasPaymentMethod && isVisible;

  // Never auto-open on fresh load; downstream can explicitly open when needed
  React.useEffect(() => {
    if (!hasPaymentMethod && !isDismissedThisSession()) {
      setIsVisible(false);
    }
  }, [hasPaymentMethod]);

  const openLater = () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {}
    setIsVisible(false);
  };

  if (!shouldShow) return null;

  return (
    <Dialog open={shouldShow} onOpenChange={(open) => !open && openLater()}>
      <DialogContent className="bg-[#1a2332] border-purple-500/20 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="w-6 h-6 text-purple-400" />
            Subscribe to Premium
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Subscribe now to secure your account and enable premium features.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
           <div className="bg-purple-900/20 p-4 rounded-lg border border-purple-500/20 mb-4">
             <p className="text-sm text-purple-200">
               Choose a plan to ensure uninterrupted service.
             </p>
           </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Button
            variant="ghost"
            onClick={openLater}
            className="text-gray-400 hover:text-white"
          >
            Remind me later
          </Button>
          <Button
            onClick={() => {
              navigate(createPageUrl("Subscription"));
              openLater();
            }}
            className="bg-purple-600 hover:bg-purple-700"
          >
            Subscribe
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
