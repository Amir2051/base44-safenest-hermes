import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, Upload, FileText } from "lucide-react";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";

export default function CreateCaseDialog({ onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [autofillText, setAutofillText] = useState("");
  const [formData, setFormData] = useState({
    case_title: "crypto_theft",
    victim_name: "",
    victim_email: "",
    victim_phone: "",
    fraud_type: "crypto_theft",
    status: "Investigating",
    amount_stolen_usd: "",
    recovery_amount: "0",
    cryptocurrency: "USD",
    blockchain: "",
    victim_wallet: "",
    scammer_wallet: "",
    incident_date: "",
    description: "",
    priority: "medium"
  });

  const [walletError, setWalletError] = useState(null);

  const detectNetwork = (address) => {
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) return "ethereum";
    if (/^(1|3)[a-zA-Z0-9]{25,34}$|^bc1[a-zA-Z0-9]{39,59}$/.test(address)) return "bitcoin";
    if (/^T[a-zA-Z0-9]{33}$/.test(address)) return "tron";
    return null;
  };

  const validateWallets = () => {
    const { victim_wallet, scammer_wallet } = formData;
    if (!victim_wallet || !scammer_wallet) {
      setWalletError("Both your wallet and the scammer's wallet are required.");
      return false;
    }

    const victimNet = detectNetwork(victim_wallet);
    const scammerNet = detectNetwork(scammer_wallet);

    if (!victimNet) {
        setWalletError("Invalid Client Wallet format. Supported: ETH, BTC, TRON.");
        return false;
    }
    if (!scammerNet) {
        setWalletError("Invalid Scammer Wallet format. Supported: ETH, BTC, TRON.");
        return false;
    }

    setWalletError(null);
    return true;
  };

  const handleWalletChange = (type, value) => {
      const net = detectNetwork(value);
      setFormData(prev => ({
          ...prev, 
          [type]: value,
          // Auto-set blockchain if scammer wallet changes and is valid
          blockchain: (type === 'scammer_wallet' && net) ? net : prev.blockchain
      }));
      setWalletError(null);
  };

  const handleAutofill = async () => {
    if (!autofillText.trim()) {
        toast.error("Please paste report text to analyze");
        return;
    }

    setAnalyzing(true);
    try {
        const res = await base44.functions.invoke('extractCaseDetails', { text: autofillText });
        if (res.data.success && res.data.data) {
            const extracted = res.data.data;
            setFormData(prev => ({
                ...prev,
                ...extracted,
                amount_stolen_usd: extracted.amount_stolen_usd?.toString() || prev.amount_stolen_usd,
                // Ensure we don't overwrite with empty/null if we already have data, unless the AI found something specific
                priority: extracted.priority || prev.priority,
                fraud_type: extracted.fraud_type || prev.fraud_type
            }));
            toast.success("Form autofilled by AI");
        }
    } catch (error) {
        console.error("Autofill error:", error);
        toast.error("Failed to analyze text");
    }
    setAnalyzing(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const user = await base44.auth.me();
      const plan = user?.subscription_plan || 'free';
      
      // Check case limit for non-premium users
      if (plan !== 'premium_unlimited') {
        const existingCases = await base44.entities.InvestigationCase.list();
        const userCases = existingCases.filter(c => c.created_by === user.email);
        
        const limits = {
          free: 1,
          basic: 3,
          elite: 10
        };
        
        const limit = limits[plan] || 0;
        
        if (userCases.length >= limit) {
          toast.error(`Case limit reached. Upgrade to Premium Unlimited for unlimited cases.`);
          setLoading(false);
          return;
        }
      }
      
      if (!validateWallets()) {
          setLoading(false);
          return;
      }

      // Use unified case management function
      const response = await base44.functions.invoke('caseManagement', {
        action: 'create',
        data: {
          // Victim
          client_name: formData.victim_name,
          client_email: formData.victim_email,
          phone_number: formData.victim_phone,
          
          // Wallets
          victim_wallet: formData.victim_wallet,
          scammer_wallet: formData.scammer_wallet,
          
          // Case Details
          issue_type: formData.fraud_type,
          amount_lost: parseFloat(formData.amount_stolen_usd) || 0,
          recovery_amount: parseFloat(formData.recovery_amount) || 0,
          cryptocurrency: formData.cryptocurrency,
          blockchain: formData.blockchain, // Auto-detected
          transaction_date: formData.incident_date,
          description: formData.description,
          urgency: formData.priority === 'critical' ? 'Critical' : formData.priority === 'high' ? 'High' : 'Medium',
          priority: formData.priority,
          
          // Meta
          status: formData.status,
          created_by: user.email,
          created_by_email: user.email,
          created_by_name: user.full_name,
          
          // Notes
          case_notes: [{
            timestamp: new Date().toISOString(),
            author: "system",
            note: "Case created - Ready for document generation",
            type: "system"
          }]
        }
      });

      if (response.data.error) throw new Error(response.data.error);

      toast.success("Case created successfully!");
      trackEvent('case_created', { event_category: 'cases' });
      onSuccess();
    } catch (error) {
      console.error('Create case error:', error);
      toast.error("Failed to create case: " + error.message);
    }
    setLoading(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#1a2332] border-cyan-500/20 text-white max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-white">Create New Investigation Case</DialogTitle>
        </DialogHeader>
        
        {/* AI Autofill Section */}
        <div className="mt-4 p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-semibold text-purple-200">AI Autofill</h3>
            </div>
            <p className="text-xs text-gray-400 mb-3">Paste a case report, email, or incident description below to automatically fill the form.</p>
            <div className="flex gap-2">
                <Textarea 
                    value={autofillText}
                    onChange={(e) => setAutofillText(e.target.value)}
                    placeholder="Paste report text here..." 
                    className="bg-[#0f1419] border-purple-500/20 text-white min-h-[60px] text-xs"
                />
                <Button 
                    type="button"
                    onClick={handleAutofill}
                    disabled={analyzing}
                    className="bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/50 h-auto"
                >
                    {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                </Button>
            </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label className="text-white">Case Title *</Label>
              <Input
                value={formData.case_title}
                onChange={(e) => setFormData({...formData, case_title: e.target.value})}
                className="bg-[#0f1419] border-cyan-500/20 text-white mt-2"
                placeholder="Brief case description"
                required
              />
            </div>

            <div>
              <Label className="text-white">Status *</Label>
              <Select value={formData.status} onValueChange={(val) => setFormData({...formData, status: val})}>
                <SelectTrigger className="bg-[#0f1419] border-cyan-500/20 text-white mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1a2332] border-cyan-500/20">
                  <SelectItem value="New">New</SelectItem>
                  <SelectItem value="Investigating">Investigating</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Resolved">Resolved</SelectItem>
                  <SelectItem value="Closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 border-t border-gray-700 pt-4 mt-2">
              <h3 className="text-cyan-400 font-semibold mb-3">Client / Victim Information</h3>
            </div>

            <div>
              <Label className="text-white">Client Name *</Label>
              <Input
                value={formData.victim_name}
                onChange={(e) => setFormData({...formData, victim_name: e.target.value})}
                className="bg-[#0f1419] border-cyan-500/20 text-white mt-2"
                required
              />
            </div>

            <div>
              <Label className="text-white">Contact Email</Label>
              <Input
                type="email"
                value={formData.victim_email}
                onChange={(e) => setFormData({...formData, victim_email: e.target.value})}
                className="bg-[#0f1419] border-cyan-500/20 text-white mt-2"
              />
            </div>

            <div>
              <Label className="text-white">Contact Phone</Label>
              <Input
                value={formData.victim_phone}
                onChange={(e) => setFormData({...formData, victim_phone: e.target.value})}
                className="bg-[#0f1419] border-cyan-500/20 text-white mt-2"
              />
            </div>

            <div>
              <Label className="text-white">Urgency</Label>
              <Select value={formData.priority} onValueChange={(val) => setFormData({...formData, priority: val})}>
                <SelectTrigger className="bg-[#0f1419] border-cyan-500/20 text-white mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1a2332] border-cyan-500/20">
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 border-t border-gray-700 pt-4 mt-2">
              <h3 className="text-cyan-400 font-semibold mb-3">Financial Information</h3>
            </div>

            <div>
              <Label className="text-white">Fraud Type *</Label>
              <Select value={formData.fraud_type} onValueChange={(val) => setFormData({...formData, fraud_type: val})}>
                <SelectTrigger className="bg-[#0f1419] border-cyan-500/20 text-white mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1a2332] border-cyan-500/20">
                  <SelectItem value="crypto_theft">Crypto Theft</SelectItem>
                  <SelectItem value="phishing">Phishing</SelectItem>
                  <SelectItem value="fake_exchange">Fake Exchange</SelectItem>
                  <SelectItem value="rug_pull">Rug Pull</SelectItem>
                  <SelectItem value="romance_scam">Romance Scam</SelectItem>
                  <SelectItem value="investment_scam">Investment Scam</SelectItem>
                  <SelectItem value="pig_butchering">Pig Butchering</SelectItem>
                  <SelectItem value="ransomware">Ransomware</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-white">Amount Stolen (USD) *</Label>
              <Input
                type="number"
                value={formData.amount_stolen_usd}
                onChange={(e) => setFormData({...formData, amount_stolen_usd: e.target.value})}
                className="bg-[#0f1419] border-cyan-500/20 text-white mt-2"
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <Label className="text-white">Recovery Amount (USD)</Label>
              <Input
                type="number"
                value={formData.recovery_amount}
                onChange={(e) => setFormData({...formData, recovery_amount: e.target.value})}
                className="bg-[#0f1419] border-cyan-500/20 text-white mt-2"
                placeholder="0.00"
              />
            </div>

            <div>
              <Label className="text-white">Cryptocurrency</Label>
              <Input
                value={formData.cryptocurrency}
                onChange={(e) => setFormData({...formData, cryptocurrency: e.target.value})}
                className="bg-[#0f1419] border-cyan-500/20 text-white mt-2"
                placeholder="USD"
              />
            </div>

            <div>
              <Label className="text-white">Blockchain</Label>
              <Select value={formData.blockchain} onValueChange={(val) => setFormData({...formData, blockchain: val})}>
                <SelectTrigger className="bg-[#0f1419] border-cyan-500/20 text-white mt-2">
                  <SelectValue placeholder="Auto-detected from wallet" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a2332] border-cyan-500/20">
                  <SelectItem value="ethereum">Ethereum</SelectItem>
                  <SelectItem value="bitcoin">Bitcoin</SelectItem>
                  <SelectItem value="bsc">BSC</SelectItem>
                  <SelectItem value="polygon">Polygon</SelectItem>
                  <SelectItem value="solana">Solana</SelectItem>
                  <SelectItem value="tron">Tron</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-white">Incident Date</Label>
              <Input
                type="date"
                value={formData.incident_date}
                onChange={(e) => setFormData({...formData, incident_date: e.target.value})}
                className="bg-[#0f1419] border-cyan-500/20 text-white mt-2"
              />
            </div>

            <div>
              <Label className="text-white">Priority</Label>
              <Select value={formData.priority} onValueChange={(val) => setFormData({...formData, priority: val})}>
                <SelectTrigger className="bg-[#0f1419] border-cyan-500/20 text-white mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1a2332] border-cyan-500/20">
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2">
              <Label className="text-white">Case Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                className="bg-[#0f1419] border-cyan-500/20 text-white mt-2 h-32"
                placeholder="Detailed description of the incident..."
              />
            </div>
          </div>

          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg mt-4">
              <h4 className="text-blue-400 font-semibold mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> 
                  Wallet & Blockchain
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                      <Label className="text-white">Victim Wallet Address *</Label>
                      <Input
                          value={formData.victim_wallet}
                          onChange={(e) => handleWalletChange('victim_wallet', e.target.value)}
                          className="bg-[#0f1419] border-cyan-500/20 text-white mt-2 font-mono text-xs"
                          placeholder="Enter your wallet address"
                          required
                      />
                      {formData.victim_wallet && detectNetwork(formData.victim_wallet) && (
                          <span className="text-xs text-green-400 mt-1 block">
                              Detected: {detectNetwork(formData.victim_wallet).toUpperCase()}
                          </span>
                      )}
                  </div>
                  <div>
                      <Label className="text-white">Scammer Wallet Address *</Label>
                      <Input
                          value={formData.scammer_wallet}
                          onChange={(e) => handleWalletChange('scammer_wallet', e.target.value)}
                          className="bg-[#0f1419] border-cyan-500/20 text-white mt-2 font-mono text-xs"
                          placeholder="Enter scammer's wallet address"
                          required
                      />
                      {formData.scammer_wallet && detectNetwork(formData.scammer_wallet) && (
                          <span className="text-xs text-green-400 mt-1 block">
                              Detected: {detectNetwork(formData.scammer_wallet).toUpperCase()}
                          </span>
                      )}
                  </div>
              </div>
              
              {walletError && (
                  <div className="mt-3 p-2 bg-red-500/20 text-red-200 text-xs rounded flex items-center gap-2">
                      <span>⚠️ {walletError}</span>
                  </div>
              )}
              <p className="text-xs text-blue-300 mt-2 font-medium">
                  Your wallet address is required to investigate this case.
              </p>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose} className="border-cyan-500/20">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="bg-gradient-to-r from-cyan-500 to-blue-600">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Case"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}