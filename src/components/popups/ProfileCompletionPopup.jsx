import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserCircle, Upload } from "lucide-react";
import { toast } from "sonner";

const STORAGE_KEY = "safenestt_profile_form";

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export default function ProfileCompletionPopup({ user, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const submittedKey = "safenestt_profile_submitted";
  const [submitted, setSubmitted] = useState(() => {
    try {
      return sessionStorage.getItem(submittedKey) === "1";
    } catch {
      return false;
    }
  });
  const saved = loadSaved();
  const [formData, setFormData] = useState({
    full_name: user?.full_name || saved.full_name || "",
    phone: user?.phone || saved.phone || "",
    profile_image: user?.profile_image || saved.profile_image || "",
  });

  useEffect(() => {
    try {
      if (submitted) sessionStorage.setItem(submittedKey, "1");
    } catch {}
  }, [submitted]);

  const isProfileIncomplete = !submitted && (!user?.full_name || !user?.phone);

  if (!user || !isProfileIncomplete) return null;

  const persist = (data) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  };

  const dismiss = () => {
    setSubmitted(true);
    try {
      sessionStorage.setItem(submittedKey, "1");
    } catch {}
    onUpdate?.();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.full_name?.trim() || !formData.phone?.trim()) {
      toast.error("Please fill in all fields");
      return;
    }
    setLoading(true);
    try {
      if (formData.profile_image) persist(formData);
      const hasSDK = typeof base44 !== "undefined" && base44 && base44.auth && base44.auth.updateMe;
      if (hasSDK) {
        await base44.auth.updateMe({
          full_name: formData.full_name.trim(),
          phone: formData.phone.trim(),
          profile_image: formData.profile_image,
        });
        toast.success("Profile updated successfully!");
      } else {
        toast.success("Profile saved locally");
      }
      dismiss();
    } catch (error) {
      console.error("Profile update error:", error);
      toast.error(error?.message || "Failed to update profile");
      persist(formData);
      dismiss();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isProfileIncomplete}>
      <DialogContent className="bg-[#1a2332] border-cyan-500/20 text-white sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <UserCircle className="w-6 h-6 text-cyan-400" />
            Complete Your Profile
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Please provide the following information to continue using SafeNestt.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="full_name" className="text-gray-200">Full Name</Label>
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => setFormData((prev) => ({ ...prev, full_name: e.target.value }))}
              placeholder="John Doe"
              className="bg-[#0f1419] border-gray-700 text-white focus:border-cyan-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone" className="text-gray-200">Phone Number</Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder="+1 (555) 000-0000"
              className="bg-[#0f1419] border-gray-700 text-white focus:border-cyan-500"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-gray-200">Profile Photo (Optional)</Label>
            <div className="flex items-center gap-3">
              {formData.profile_image && (
                <img
                  src={formData.profile_image}
                  alt="Profile"
                  className="w-12 h-12 rounded-full object-cover border-2 border-cyan-500/30"
                />
              )}
              <input
                type="file"
                id="popup-photo-upload"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const uploadToast = toast.loading("Uploading...");
                  try {
                    const core = typeof base44 !== "undefined" ? base44?.integrations?.Core : null;
                    if (!core) {
                      toast.error("Profile editor is running in local-only mode; upload is unavailable", { id: uploadToast });
                      return;
                    }
                    const { file_url } = await core.UploadFile({ file });
                    setFormData((prev) => ({ ...prev, profile_image: file_url }));
                    toast.success("Photo uploaded", { id: uploadToast });
                  } catch (error) {
                    toast.error("Upload failed", { id: uploadToast });
                  }
                }}
              />
              <label htmlFor="popup-photo-upload" className="flex-1">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById("popup-photo-upload")?.click();
                  }}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {formData.profile_image ? "Change Photo" : "Upload Photo"}
                </Button>
              </label>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full bg-cyan-600 hover:bg-cyan-700 mt-4"
            disabled={loading}
          >
            {loading ? "Saving..." : "Save & Continue"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
