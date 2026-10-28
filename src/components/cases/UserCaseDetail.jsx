import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  X, FileText, Clock, User, DollarSign, Shield, Upload, 
  MessageSquare, Calendar, AlertCircle, Save, Phone, Mail, 
  Download, Eye, Send, MapPin
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import TimelineFeed from "../investigation/TimelineFeed.jsx";
import SensitiveField from "../investigation/SensitiveField.jsx";
import SecureMessenger from "../communication/SecureMessenger";
import PaymentTransactionsView from "./PaymentTransactionsView";
import SharedFilesPanel from "./SharedFilesPanel";
import EvidenceFilesPanel from "./EvidenceFilesPanel";
import CaseInvestigationTimeline from "./CaseInvestigationTimeline";

export default function UserCaseDetail({ caseData, onClose }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [uploading, setUploading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const [liveCase, setLiveCase] = React.useState(caseData);

  // Real-time sync so status updates from admin are immediately visible to user
  React.useEffect(() => {
    const unsub = base44.entities.MyCase.subscribe((event) => {
      if (event.id === caseData.id && event.data) {
        setLiveCase(prev => ({ ...prev, ...event.data }));
      }
    });
    return unsub;
  }, [caseData.id]);

  const updateCaseMutation = useMutation({
    mutationFn: async (updates) => {
      if (!caseData.id) throw new Error("Missing case ID");
      const entityName = caseData._entityName || 'MyCase';
      if (!['MyCase', 'InvestigationCase'].includes(entityName)) {
        throw new Error("This case type has not been migrated to the custom API yet.");
      }
      // The custom API derives ownership from the signed-in session and refuses
      // owner-field edits; regular users no longer need the Base44 caseManagement function.
      return base44.entities[entityName].update(caseData.id, {
        ...updates,
        updated_by_user: true,
      });
    },
    onSuccess: (updated) => {
      if (updated) setLiveCase(prev => ({ ...prev, ...updated }));
      queryClient.invalidateQueries({ queryKey: ['my-cases'] });
      toast.success("✅ Case successfully updated.");
    },
    onError: (err) => {
      toast.error("❌ Update failed: " + err.message);
    }
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const toastId = toast.loading("Uploading evidence...");
      const response = await base44.integrations.Core.UploadFile({ file });
      
      // Create CaseEvidenceFile
      await base44.entities.CaseEvidenceFile.create({
          case_id: caseData.id,
          file_url: response.file_url,
          filename: file.name,
          file_size: file.size,
          mime_type: file.type,
          uploaded_at: new Date().toISOString(),
          uploaded_by_user: true
      });

      // Update legacy arrays for immediate display if needed
      const evidence = caseData.evidence_files || [];
      evidence.push({
        name: file.name,
        url: response.file_url,
        type: file.type,
        uploaded_date: new Date().toISOString(),
        description: "User uploaded evidence"
      });

      await updateCaseMutation.mutateAsync({ evidence_files: evidence });
      toast.success("Evidence uploaded", { id: toastId });
      
    } catch (error) {
      toast.error("Upload failed");
    }
    setUploading(false);
  };



  const downloadReceipt = async () => {
    const toastId = toast.loading("Generating Receipt...");
    try {
        // We can reuse generateCasePdf but might want a simplified version later
        // For now, let's assume generateCasePdf creates a suitable report/receipt
        const response = await base44.functions.invoke('generateCasePdf', { caseId: caseData.id, type: 'receipt' });

        if (response.headers && response.headers['content-type'] === 'application/json') {
            if (response.data.error) throw new Error(response.data.error);
        }

        const blob = new Blob([response.data], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Case_Receipt_${caseData.case_number}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        toast.success("Receipt Downloaded", { id: toastId });
    } catch (e) {
        toast.error("Generation failed", { id: toastId });
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#1a2332] border-cyan-500/20 text-white max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-2xl font-bold text-white mb-2 flex items-center gap-3">
                {caseData.case_title}
                <Badge variant="outline" className="border-cyan-500/50 text-cyan-400">
                  User View
                </Badge>
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/50 font-mono">
                  {caseData.case_number}
                </Badge>
                <Badge className="bg-gray-700 text-gray-300">
                  {caseData.status}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={downloadReceipt} className="border-cyan-500/30 text-cyan-400">
                    <Download className="w-4 h-4 mr-2" />
                    Download Receipt
                </Button>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="w-5 h-5" />
                </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-4">
            {/* Status Banner — uses liveCase for real-time admin updates */}
            <div className={`p-4 rounded-lg mb-6 flex items-center gap-4 border ${
              liveCase.status?.toLowerCase().includes('resolv') || liveCase.status?.toLowerCase().includes('recover')
                ? 'bg-green-900/20 border-green-500/30'
                : liveCase.status?.toLowerCase().includes('review') || liveCase.status?.toLowerCase().includes('progress') || liveCase.status?.toLowerCase().includes('investigat')
                ? 'bg-blue-900/20 border-blue-500/30'
                : 'bg-gradient-to-r from-blue-900/20 to-cyan-900/20 border-cyan-500/20'
            }`}>
                <div className="p-2 bg-cyan-500/10 rounded-full">
                    <Clock className="w-6 h-6 text-cyan-400" />
                </div>
                <div>
                    <h4 className="font-semibold text-white">Current Status: <span className="text-cyan-300">{liveCase.status}</span></h4>
                    <p className="text-sm text-gray-400">
                        {liveCase.status === 'Pending' ? "Your case has been received and is awaiting investigator assignment." :
                         liveCase.status?.toLowerCase().includes('review') ? "Your case is currently being reviewed by our team." :
                         liveCase.status?.toLowerCase().includes('investigat') || liveCase.status?.toLowerCase().includes('progress') ? "An investigator is actively working on your case." :
                         liveCase.status?.toLowerCase().includes('resolv') ? "Your case has been resolved. Please check the timeline for details." :
                         "Please check the timeline for the latest updates."}
                    </p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="bg-[#0f1419] border border-cyan-500/30 w-full justify-start overflow-x-auto">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="my-info">My Information</TabsTrigger>
                    <TabsTrigger value="suspect">Suspect Info</TabsTrigger>
                    <TabsTrigger value="evidence">Evidence</TabsTrigger>
                    <TabsTrigger value="shared-files" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400">
                      <Upload className="w-3 h-3 mr-1" />Shared Files
                    </TabsTrigger>
                    <TabsTrigger value="progress">Progress</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="messages">Messages</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4 mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 bg-[#0f1419] rounded-lg border border-gray-700">
                            <h3 className="text-lg font-semibold text-white mb-4">Case Summary</h3>
                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Submission Date</span>
                                    <span className="text-white">{new Date(caseData.created_date).toLocaleDateString()}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Fraud Type</span>
                                    <span className="text-white capitalize">{caseData.issue_type?.replace(/_/g, ' ')}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Amount Lost</span>
                                    <span className="text-white">${caseData.amount_lost?.toLocaleString()} {caseData.cryptocurrency}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Blockchain</span>
                                    <span className="text-white">{caseData.blockchain}</span>
                                </div>
                            </div>
                        </div>

                        <div className="p-4 bg-[#0f1419] rounded-lg border border-gray-700">
                            <h3 className="text-lg font-semibold text-white mb-4">Description</h3>
                            <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                                {caseData.description}
                            </p>
                        </div>
                    </div>

                    {/* Payment Transactions */}
                    {caseData.payment_transactions && caseData.payment_transactions.length > 0 && (
                        <div className="mt-6">
                            <PaymentTransactionsView 
                                transactions={caseData.payment_transactions}
                                totalAmount={caseData.amount_lost}
                            />
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="my-info" className="space-y-4 mt-4">
                    <div className="p-4 bg-[#0f1419] rounded-lg border border-gray-700">
                        <h3 className="text-lg font-semibold text-white mb-4">My Submitted Details</h3>
                        <p className="text-sm text-gray-400 mb-4">You can update your contact information here.</p>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <SensitiveField 
                                field="client_name" 
                                value={caseData.client_name} 
                                label="Full Name"
                                caseData={caseData} onUpdate={() => queryClient.invalidateQueries(['my-cases'])}
                            />
                            <SensitiveField 
                                field="phone_number" 
                                value={caseData.phone_number} 
                                label="Phone Number"
                                icon={Phone}
                                caseData={caseData} onUpdate={() => queryClient.invalidateQueries(['my-cases'])}
                            />
                            <SensitiveField 
                                field="victim_wallet" 
                                value={caseData.victim_wallet} 
                                label="My Wallet Address"
                                icon={Shield}
                                caseData={caseData} onUpdate={() => queryClient.invalidateQueries(['my-cases'])}
                            />
                        </div>

                        {/* Address Information Section */}
                        <div className="mt-6 pt-6 border-t border-gray-700">
                            <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-cyan-400" />
                                My Address (Optional)
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <Label className="text-gray-300 text-sm">Street Address</Label>
                                    <Input 
                                        className="bg-[#1a2332] border-gray-600 mt-1" 
                                        defaultValue={caseData.address_information?.street_address}
                                        onBlur={(e) => updateCaseMutation.mutate({ 
                                            address_information: { 
                                                ...caseData.address_information, 
                                                street_address: e.target.value 
                                            } 
                                        })}
                                    />
                                </div>
                                <div>
                                    <Label className="text-gray-300 text-sm">Apartment / Unit</Label>
                                    <Input 
                                        className="bg-[#1a2332] border-gray-600 mt-1" 
                                        defaultValue={caseData.address_information?.apartment_unit}
                                        onBlur={(e) => updateCaseMutation.mutate({ 
                                            address_information: { 
                                                ...caseData.address_information, 
                                                apartment_unit: e.target.value 
                                            } 
                                        })}
                                    />
                                </div>
                                <div>
                                    <Label className="text-gray-300 text-sm">City</Label>
                                    <Input 
                                        className="bg-[#1a2332] border-gray-600 mt-1" 
                                        defaultValue={caseData.address_information?.city}
                                        onBlur={(e) => updateCaseMutation.mutate({ 
                                            address_information: { 
                                                ...caseData.address_information, 
                                                city: e.target.value 
                                            } 
                                        })}
                                    />
                                </div>
                                <div>
                                    <Label className="text-gray-300 text-sm">State / Province</Label>
                                    <Input 
                                        className="bg-[#1a2332] border-gray-600 mt-1" 
                                        defaultValue={caseData.address_information?.state_province}
                                        onBlur={(e) => updateCaseMutation.mutate({ 
                                            address_information: { 
                                                ...caseData.address_information, 
                                                state_province: e.target.value 
                                            } 
                                        })}
                                    />
                                </div>
                                <div>
                                    <Label className="text-gray-300 text-sm">ZIP / Postal Code</Label>
                                    <Input 
                                        className="bg-[#1a2332] border-gray-600 mt-1" 
                                        defaultValue={caseData.address_information?.zip_postal_code}
                                        onBlur={(e) => updateCaseMutation.mutate({ 
                                            address_information: { 
                                                ...caseData.address_information, 
                                                zip_postal_code: e.target.value 
                                            } 
                                        })}
                                    />
                                </div>
                                <div>
                                    <Label className="text-gray-300 text-sm">Country</Label>
                                    <Input 
                                        className="bg-[#1a2332] border-gray-600 mt-1" 
                                        defaultValue={caseData.address_information?.country}
                                        onBlur={(e) => updateCaseMutation.mutate({ 
                                            address_information: { 
                                                ...caseData.address_information, 
                                                country: e.target.value 
                                            } 
                                        })}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="suspect" className="space-y-4 mt-4">
                    <div className="p-4 bg-[#0f1419] rounded-lg border border-gray-700">
                        <h3 className="text-lg font-semibold text-white mb-4">Suspect Information</h3>
                        <p className="text-sm text-gray-400 mb-4">Add or update any information you have about the scammer.</p>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Scammer Name / Alias</Label>
                                <Input 
                                    className="bg-[#1a2332] border-gray-600" 
                                    defaultValue={caseData.scammer_info?.name}
                                    onBlur={(e) => updateCaseMutation.mutate({ 
                                        scammer_info: { ...caseData.scammer_info, name: e.target.value } 
                                    })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Scammer Email</Label>
                                <Input 
                                    className="bg-[#1a2332] border-gray-600" 
                                    defaultValue={caseData.scammer_info?.email}
                                    onBlur={(e) => updateCaseMutation.mutate({ 
                                        scammer_info: { ...caseData.scammer_info, email: e.target.value } 
                                    })}
                                />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <Label>Scammer Wallet Address</Label>
                                <Input 
                                    className="bg-[#1a2332] border-gray-600 font-mono" 
                                    defaultValue={caseData.scammer_wallet}
                                    onBlur={(e) => updateCaseMutation.mutate({ 
                                        scammer_wallet: e.target.value,
                                        scammer_info: { ...caseData.scammer_info, wallet_addresses: [e.target.value] }
                                    })}
                                />
                            </div>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="evidence" className="space-y-4 mt-4">
                    <h3 className="text-white font-semibold">Evidence Files</h3>
                    <EvidenceFilesPanel
                        caseId={caseData.id}
                        legacyFiles={caseData.evidence_files || []}
                        allowUpload={true}
                        onUploadComplete={() => queryClient.invalidateQueries({ queryKey: ['my-cases'] })}
                    />
                </TabsContent>

                <TabsContent value="shared-files" className="space-y-4 mt-4">
                    <SharedFilesPanel 
                      caseId={caseData.id}
                      caseData={caseData}
                      isAdmin={false}
                      currentUser={currentUser}
                    />
                </TabsContent>

                <TabsContent value="progress" className="space-y-4 mt-4">
                    <CaseInvestigationTimeline caseData={liveCase} />
                </TabsContent>

                <TabsContent value="timeline" className="space-y-4 mt-4">
                    <TimelineFeed caseId={caseData.id} initialTimeline={caseData.timeline} readOnly={true} />
                </TabsContent>

                <TabsContent value="messages" className="space-y-4 mt-4">
                    <div className="p-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-lg mb-4">
                        <h4 className="text-cyan-400 font-semibold flex items-center gap-2 mb-1">
                            <Shield className="w-4 h-4" />
                            Secure Communication Portal
                        </h4>
                        <p className="text-sm text-gray-300">
                            All messages are encrypted and monitored by our security team. 
                            Your investigator will respond within 24-48 hours.
                        </p>
                    </div>

                    <SecureMessenger 
                        caseId={caseData.id}
                        caseData={caseData}
                        currentUser={currentUser}
                        isAdmin={false}
                    />
                </TabsContent>
            </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}