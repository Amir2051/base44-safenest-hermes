import React, { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  X, FileText, Clock, User, DollarSign, Shield, Upload, Plus, 
  MessageSquare, ExternalLink, Calendar, AlertCircle, Database, Building2,
  Edit, Save, Phone, Mail, MapPin, TrendingUp, Network, Sparkles, RefreshCw,
  Eye, EyeOff, CheckCircle, ShieldAlert, Brain, Zap
} from "lucide-react";
import InvestigationNotes from "./InvestigationNotes.jsx";
import RecommendedAgencies from "./RecommendedAgencies.jsx";
import CaseDocuments from "./CaseDocuments.jsx";
import SuspectEditForm from "./SuspectEditForm.jsx";
import TrackingToolsPanel from "@/components/admin/TrackingToolsPanel.jsx";
import AgencyReportGenerator from "./AgencyReportGenerator.jsx";
import CryptoIntelligenceReport from "./CryptoIntelligenceReport.jsx";
import RelatedCasesPanel from "./RelatedCasesPanel.jsx";
import AdminEvidenceUpload from "./AdminEvidenceUpload.jsx";
import TimelineFeed from "./TimelineFeed.jsx";
import FilePreviewModal from "./FilePreviewModal.jsx";
import CaseSummaryGenerator from "./CaseSummaryGenerator.jsx";
import EvidenceIntake from "./evidence/EvidenceIntake.jsx";
import CaseWalletTracer from "./CaseWalletTracer.jsx";
import ResponseTemplates from "./ResponseTemplates.jsx";
import QuickActionsPanel from "./QuickActionsPanel.jsx";
import SensitiveField from "./SensitiveField.jsx";
import { toast } from "sonner";
import CaseTaskManager from "@/components/collaboration/CaseTaskManager.jsx";
import CyberFraudProfileBuilder from "./CyberFraudProfileBuilder.jsx";
import CommunicationLog from "./communication/CommunicationLog.jsx";
import AdvancedBlockchainViewer from "./AdvancedBlockchainViewer.jsx";
import CrossCaseCorrelator from "./CrossCaseCorrelator.jsx";
import PatternLibrary from "./PatternLibrary.jsx";
import InvestigationAICenter from "./InvestigationAICenter.jsx";
import MultiFileUploader from "@/components/shared/MultiFileUploader";
import SecureMessenger from "../communication/SecureMessenger";
import AIFraudInsights from "../ai/AIFraudInsights";
import AIPriorityBadge from "../ai/AIPriorityBadge";
import WalletRiskChecker from "../ai/WalletRiskChecker";
import AutomatedReportGenerator from "../reports/AutomatedReportGenerator";
import PaymentTransactionsView from "../cases/PaymentTransactionsView";
import TransactionsList from "../cases/TransactionsList";
import SharedFilesPanel from "../cases/SharedFilesPanel";

export default function CaseDetailDialog({ caseData, onClose, onUpdate }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [previewFile, setPreviewFile] = useState(null);
  const fileInputRef = useRef(null);
  const [newNote, setNewNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState(null);
  const [liveCase, setLiveCase] = useState(caseData);
  const caseEntityName = caseData._entityName || caseData.entity_name || "MyCase";
  const caseEntity = base44.entities[caseEntityName] || base44.entities.MyCase;
  const prevStatusRef = useRef(caseData.status);

  useEffect(() => {
    base44.auth.me().then(u => {
        setUser(u);
        const isAuthorized = u?.role === 'admin' || u?.is_admin || u?.job_title === 'Fraud Specialist';
        if (u && !isAuthorized) {
            toast.error("Unauthorized access to Investigator View");
            if (onClose) onClose();
        }
    }).catch(() => {});
  }, []);

  // Real-time sync so dialog reflects external changes immediately
  useEffect(() => {
    if (typeof caseEntity?.subscribe !== "function") return undefined;
    const unsub = caseEntity.subscribe((event) => {
      if (event.id === caseData.id && event.data) {
        setLiveCase(prev => ({ ...prev, ...event.data }));
      }
    });
    return typeof unsub === "function" ? unsub : undefined;
  }, [caseData.id, caseEntityName]);

  const isAdmin = user?.role === 'admin' || user?.is_admin;
  // Use liveCase for display so UI reflects updates immediately without closing dialog
  const redactedFields = liveCase.redacted_fields || caseData.redacted_fields || [];

  const isFieldRedacted = (field) => redactedFields.includes(field);

  // Helper to render sensitive fields with redaction logic
  const RenderSensitiveField = ({ field, value, icon: Icon, label }) => {
    // Legacy support for parts of the component that haven't been migrated to SensitiveField yet
    // or if we need inline rendering
    return (
        <SensitiveField 
            field={field} 
            value={value} 
            icon={Icon} 
            label={label} 
            caseData={caseData} 
            onUpdate={onUpdate} 
            isAdmin={isAdmin} 
        />
    );
  };

  const [editedCase, setEditedCase] = useState({
    // Standardized Fields (ClientCase Schema)
    case_title: caseData.case_title || caseData.case_number || 'Untitled Case',
    client_name: caseData.client_name || caseData.victim_name || '',
    client_email: caseData.client_email || caseData.victim_email || '',
    phone_number: caseData.phone_number || caseData.victim_phone || '',
    amount_lost: caseData.amount_lost || caseData.amount_stolen_usd || 0,
    address_information: caseData.address_information || {},

    // CRITICAL: Required field for MyCase schema
    incident_classification: caseData.incident_classification || caseData.issue_type || 'other_cyber_fraud',
    issue_type: caseData.issue_type || 'other',

    // Common Fields
    victim_wallet: caseData.victim_wallet || '',
    cryptocurrency: caseData.cryptocurrency || '',
    blockchain: caseData.blockchain || '',
    description: caseData.description || '',
    status: caseData.status || 'Pending',
    urgency: caseData.urgency || caseData.priority || 'Medium',
    investigation_progress: caseData.investigation_progress || 0,
    ic3_complaint_number: caseData.ic3_complaint_number || '',
    federal_case_number: caseData.federal_case_number || '',
    recovery_amount: caseData.recovery_amount || 0,
    monitored_wallets: caseData.monitored_wallets || [],
    scammer_info: caseData.scammer_info || {},
    scammer_wallet: caseData.scammer_wallet || '',
    law_enforcement_authorization: caseData.law_enforcement_authorization || { authorized: false, agencies: [], full_name: '' },
    payment_transactions: caseData.payment_transactions || [],
    
    // Preserve ID and other metadata
    id: caseData.id,
    created_date: caseData.created_date
  });

  const updateCaseMutation = useMutation({
    mutationFn: async (updates) => {
      if (!caseData.id) throw new Error("Missing case ID — cannot update");
      console.log('🔄 Updating case directly via entity SDK:', caseData.id, updates);
      if (typeof caseEntity?.update !== "function") {
        throw new Error(`Case entity ${caseEntityName} does not support updates`);
      }
      const updated = await caseEntity.update(caseData.id, updates);
      console.log('✅ Entity update result:', updated);
      return updated;
    },
    onSuccess: async (updatedCase, updates) => {
      toast.success("✅ Case successfully updated.", { duration: 3000 });
      setEditing(false);
      setSaving(false);
      // Keep liveCase in sync immediately
      if (updatedCase) setLiveCase(prev => ({ ...prev, ...updatedCase }));

      // Send notification to user if status changed
      const newStatus = updates.status;
      if (newStatus && newStatus !== prevStatusRef.current) {
        prevStatusRef.current = newStatus;
        const recipientEmail = caseData.client_email || caseData.created_by_email || caseData.created_by;
        if (recipientEmail && !recipientEmail.includes('no-reply') && !recipientEmail.startsWith('service+')) {
          base44.integrations.Core.SendEmail({
            to: recipientEmail,
            subject: `Case Update: ${caseData.case_number || 'Your Case'} — Status Changed`,
            body: `Hello,\n\nYour case (${caseData.case_number || caseData.case_title}) has been updated.\n\nNew Status: ${newStatus}\n\nPlease log in to SafeNestt to check the latest status and any notes from your investigator.\n\n— SafeNestt Team`
          }).catch(() => {}); // Fire-and-forget
        }
      }

      // Invalidate all relevant queries so both admin + user screens refresh
      if (onUpdate) onUpdate();
    },
    onError: (err) => {
      if (err.message.includes("not found") || err.message.includes("Case with ID")) {
        toast.error("❌ Case not found — it may have been deleted", { duration: 5000 });
        if (onClose) onClose();
      } else {
        toast.error("❌ Update failed: " + err.message, { duration: 6000 });
      }
      setSaving(false);
    }
  });

  const addNote = async () => {
    if (!newNote.trim()) return;

    const notes = caseData.case_notes || [];
    notes.push({
      timestamp: new Date().toISOString(),
      author: "investigator",
      note: newNote,
      type: "manual"
    });

    await updateCaseMutation.mutateAsync({ case_notes: notes, last_activity: new Date().toISOString() });
    setNewNote("");
  };

  const updateStatus = async (status) => {
    await updateCaseMutation.mutateAsync({ status, last_activity: new Date().toISOString() });
  };

  const updateProgress = async (progress) => {
    await updateCaseMutation.mutateAsync({ 
      investigation_progress: Math.min(100, Math.max(0, progress)),
      last_activity: new Date().toISOString() 
    });
  };

  const updatePriority = async (priority) => {
    await updateCaseMutation.mutateAsync({ 
      priority, 
      case_priority: priority,
      last_activity: new Date().toISOString() 
    });
  };

  const saveEdits = async () => {
    console.log('💾 FRONTEND: saveEdits called', {
      caseId: caseData.id,
      entityName: caseData._entityName || 'MyCase',
      editedData: editedCase
    });
    
    setSaving(true);
    
    try {
      const updates = {
        // CRITICAL: Include required fields from MyCase schema
        incident_classification: editedCase.incident_classification || caseData.incident_classification || 'other_cyber_fraud',
        
        // Direct bindings to MyCase schema
        client_name: editedCase.client_name,
        client_email: editedCase.client_email,
        phone_number: editedCase.phone_number,
        amount_lost: parseFloat(editedCase.amount_lost) || 0,
        address_information: editedCase.address_information,
        
        // Additional fields
        case_number: editedCase.case_number,
        case_title: editedCase.case_title,
        description: editedCase.description,
        status: editedCase.status,
        urgency: editedCase.urgency,
        issue_type: editedCase.issue_type || caseData.issue_type,
        
        // Crypto/Scam details
        victim_wallet: editedCase.victim_wallet,
        cryptocurrency: editedCase.cryptocurrency,
        blockchain: editedCase.blockchain,
        scammer_wallet: editedCase.scammer_wallet,
        monitored_wallets: editedCase.monitored_wallets,
        scammer_info: editedCase.scammer_info,
        
        // Progress & Meta
        investigation_progress: parseInt(editedCase.investigation_progress) || 0,
        recovery_amount: parseFloat(editedCase.recovery_amount) || 0,
        
        // Legal
        ic3_complaint_number: editedCase.ic3_complaint_number,
        federal_case_number: editedCase.federal_case_number,
        law_enforcement_authorization: editedCase.law_enforcement_authorization,
        
        // Payment transactions if edited
        payment_transactions: editedCase.payment_transactions,
        
        // Metadata
        last_activity: new Date().toISOString()
      };

      console.log('📤 FRONTEND: Calling mutation with updates:', updates);
      
      // Use mutateAsync and await it to ensure completion before state changes
      await updateCaseMutation.mutateAsync(updates);
      console.log('✅ FRONTEND: Update mutation completed successfully');
      
    } catch (error) {
      console.error('❌ FRONTEND: saveEdits caught error:', error);
      // Error handled in mutation onError, but also set saving to false here
      setSaving(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const toastId = toast.loading("Uploading and analyzing evidence...");
      const response = await base44.integrations.Core.UploadFile({ file });
      
      // 1. Create CaseEvidenceFile Entity (Metadata)
      const evidenceFile = await base44.entities.CaseEvidenceFile.create({
          case_id: caseData.id,
          file_url: response.file_url,
          filename: file.name,
          file_size: file.size,
          mime_type: file.type,
          uploader_id: user?.id,
          case_owner_email: user?.email,
          uploaded_at: new Date().toISOString(),
          parse_status: 'PENDING'
      });

      // 2. Trigger Automated Parsing
      // Await to ensure we catch errors and show success
      try {
          const processRes = await base44.functions.invoke('evidenceProcessing', {
              action: 'process_upload',
              data: {
                  caseId: caseData.id,
                  entityName: caseData._entityName || 'MyCase', 
                  evidenceFileId: evidenceFile.id,
                  fileUrl: response.file_url,
                  fileType: file.type,
                  fileName: file.name
              }
          });
          
          if (processRes.data.error) throw new Error(processRes.data.error);
          toast.success("AI Analysis Complete", { id: toastId });
          if (onUpdate) onUpdate();
      } catch (err) {
          console.error("AI Analysis failed:", err);
          toast.warning("File uploaded, but AI analysis failed: " + err.message, { id: toastId });
          if (onUpdate) onUpdate(); // Still refresh to show the file
      }

      // 3. Update Case Arrays (Legacy/UI compatibility)
      const evidence = caseData.evidence_files || [];
      evidence.push({
        name: file.name,
        url: response.file_url,
        type: file.type,
        uploaded_date: new Date().toISOString()
      });

      const evidenceLog = caseData.evidence_log || [];
      evidenceLog.push({
        timestamp: new Date().toISOString(),
        evidence_type: file.type.includes('image') ? 'screenshot' : 'document',
        file_url: response.file_url,
        description: file.name,
        collected_by: "admin",
        verified: false,
        summary: { analysis_text: "Analysis in progress..." } // Placeholder
      });

      await updateCaseMutation.mutateAsync({ evidence_files: evidence, evidence_log: evidenceLog });
      
    } catch (error) {
      console.error(error);
      toast.error("Upload failed");
    }
    setUploading(false);
  };
  const progress = caseData.investigation_progress || 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#1a2332] border-cyan-500/20 text-white max-w-7xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-2xl font-bold text-white mb-2">
                {caseData.case_title}
              </DialogTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/50 font-mono">
                  {caseData.case_number}
                </Badge>
                <Badge className={`${
                  (caseData.priority || caseData.case_priority) === 'critical' ? 'bg-red-500/20 text-red-400 border-red-500/50' :
                  (caseData.priority || caseData.case_priority) === 'high' ? 'bg-orange-500/20 text-orange-400 border-orange-500/50' :
                  (caseData.priority || caseData.case_priority) === 'medium' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50' :
                  'bg-gray-500/20 text-gray-400 border-gray-500/50'
                }`}>
                  {caseData.priority || caseData.case_priority || 'medium'}
                </Badge>
                {caseData.priority_score && (
                  <AIPriorityBadge score={caseData.priority_score} />
                )}
                <Badge variant="outline" className="text-xs">
                  Progress: {progress}%
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                size="sm" 
                onClick={() => setActiveTab('edit')} 
                className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit Case
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-5 h-5" />
              </Button>
              </div>
              </div>
              <div className="flex justify-end pr-8 pb-2">
              <Button 
                  size="sm" 
                  variant="outline" 
                  className="text-xs h-7 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 gap-2"
                  onClick={async () => {
                      const toastId = toast.loading("Generating PDF Report...");
                      try {
                          const response = await base44.functions.invoke('generateCasePdf', { caseId: caseData.id });

                          if (response.headers && response.headers['content-type'] === 'application/json') {
                              // It's an error JSON
                              if (response.data.error) throw new Error(response.data.error);
                          }

                          // If successful blob
                          const blob = new Blob([response.data], { type: 'application/pdf' });
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `Case_${caseData.case_number || 'Report'}.pdf`;
                          document.body.appendChild(a);
                          a.click();
                          window.URL.revokeObjectURL(url);
                          toast.success("Report Downloaded", { id: toastId });
                      } catch (e) {
                          // Try to read error from blob if it exists
                          let errorMsg = "Generation failed";
                          if (e.response?.data instanceof ArrayBuffer) {
                              try {
                                  const dec = new TextDecoder();
                                  const text = dec.decode(e.response.data);
                                  const json = JSON.parse(text);
                                  errorMsg = json.error || errorMsg;
                              } catch(err){}
                          } else if (e.message) {
                              errorMsg = e.message;
                          }
                          toast.error(errorMsg, { id: toastId });
                      }
                  }}
              >
                  <FileText className="w-3 h-3" />
                  Download PDF Report
              </Button>
              </div>
              </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Quick Actions */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-gray-300 text-sm">Status:</Label>
              <select
                value={liveCase.status || caseData.status}
                onChange={(e) => {
                  setLiveCase(prev => ({ ...prev, status: e.target.value }));
                  updateStatus(e.target.value);
                }}
                className="px-4 py-2 bg-[#0f1419] border border-cyan-500/30 rounded-lg text-white text-sm font-medium"
              >
                <option value="Pending">Pending</option>
                <option value="In Review">In Review</option>
                <option value="new">New</option>
                <option value="investigating">Investigating</option>
                <option value="In Progress">In Progress</option>
                <option value="documented">Documented</option>
                <option value="submitted">Submitted</option>
                <option value="law_enforcement">Law Enforcement</option>
                <option value="Called">Called</option>
                <option value="recovering">Recovering</option>
                <option value="recovered">Recovered</option>
                <option value="Resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-gray-300 text-sm">Priority:</Label>
              <select
                value={liveCase.priority || liveCase.case_priority || caseData.priority || caseData.case_priority || 'medium'}
                onChange={(e) => {
                  setLiveCase(prev => ({ ...prev, priority: e.target.value }));
                  updatePriority(e.target.value);
                }}
                className="px-4 py-2 bg-[#0f1419] border border-cyan-500/30 rounded-lg text-white text-sm font-medium"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-gray-300 text-sm">Progress:</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={progress}
                onChange={(e) => updateProgress(parseInt(e.target.value))}
                className="w-20 bg-[#0f1419] border-cyan-500/30 text-white"
              />
              <span className="text-gray-300 text-sm">%</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="p-4 bg-[#0f1419] rounded-lg border border-cyan-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-300 text-sm font-medium">Investigation Progress</span>
              <span className="text-cyan-400 font-bold">{progress}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${
                  progress === 100 ? 'bg-green-500' :
                  progress >= 75 ? 'bg-cyan-500' :
                  progress >= 50 ? 'bg-blue-500' :
                  progress >= 25 ? 'bg-yellow-500' : 'bg-orange-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* AI Summary Section */}
          <div className="p-4 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-lg">
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                    <h4 className="text-blue-400 font-semibold text-sm flex items-center gap-2 mb-2">
                        <Sparkles className="w-4 h-4" />
                        AI Executive Summary
                    </h4>
                    {caseData.ai_analysis ? (
                        <p className="text-gray-200 text-sm leading-relaxed">
                            {caseData.ai_analysis}
                        </p>
                    ) : (
                        <p className="text-gray-500 text-sm italic">
                            No summary generated yet. Click generate to analyze case details.
                        </p>
                    )}
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setActiveTab('ai-hub')}
                    className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10 shrink-0"
                >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {caseData.ai_analysis ? 'Re-run in AI Hub' : 'Generate in AI Hub'}
                </Button>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="bg-[#0f1419] border border-cyan-500/30 flex-wrap h-auto">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="ai-insights" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400">
                <Brain className="w-3 h-3 mr-1" />AI Insights
              </TabsTrigger>
              <TabsTrigger value="ai-hub" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400 border border-purple-500/30">
                <Zap className="w-3 h-3 mr-1" />AI Hub
              </TabsTrigger>
              <TabsTrigger value="edit" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400">
                <Edit className="w-3 h-3 mr-1" />Edit Case
              </TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="shared-files" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400">
                <Upload className="w-3 h-3 mr-1" />Shared Files
              </TabsTrigger>
              <TabsTrigger value="victim">Client Details</TabsTrigger>
              <TabsTrigger value="suspect">Suspect Details</TabsTrigger>
              <TabsTrigger value="edit-suspect" className="data-[state=active]:bg-red-500/20 data-[state=active]:text-red-400">
                <AlertCircle className="w-3 h-3 mr-1" />Edit Suspect
              </TabsTrigger>
              <TabsTrigger value="evidence">Evidence Intake</TabsTrigger>
              <TabsTrigger value="legacy-evidence" className="text-gray-500">Legacy Files</TabsTrigger>
              <TabsTrigger value="timeline">Timeline & Updates</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="tasks" className="data-[state=active]:bg-pink-500/20 data-[state=active]:text-pink-400">
                <CheckCircle className="w-3 h-3 mr-1" />Tasks
              </TabsTrigger>
              <TabsTrigger value="tracking">Wallet Tracking</TabsTrigger>
              <TabsTrigger value="technical-tools" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400">
                <Shield className="w-3 h-3 mr-1" />IP Tracker
              </TabsTrigger>
              <TabsTrigger value="agencies">Agencies</TabsTrigger>
              <TabsTrigger value="summary" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
                <FileText className="w-3 h-3 mr-1" />Case Summary
              </TabsTrigger>
              <TabsTrigger value="reports" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400">
                <FileText className="w-3 h-3 mr-1" />Agency Reports
              </TabsTrigger>
              <TabsTrigger value="intel-report" className="data-[state=active]:bg-red-500/20 data-[state=active]:text-red-400">
                <Shield className="w-3 h-3 mr-1" />Crypto Intel
              </TabsTrigger>
              <TabsTrigger value="connections" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400">
                <Network className="w-3 h-3 mr-1" />Connections
              </TabsTrigger>
              <TabsTrigger value="advanced-tools" className="data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-400 border border-indigo-500/30">
                <Sparkles className="w-3 h-3 mr-1" />Advanced Investigation
              </TabsTrigger>
              <TabsTrigger value="communications" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-400">
                <MessageSquare className="w-3 h-3 mr-1" />Comms & Logs
              </TabsTrigger>
              <TabsTrigger value="cyber-profile" className="data-[state=active]:bg-red-500/20 data-[state=active]:text-red-400">
                <ShieldAlert className="w-3 h-3 mr-1" />Cyber Profile
              </TabsTrigger>
              </TabsList>

            <TabsContent value="overview" className="space-y-4">
              {/* Redaction Control Panel (Admin Only) */}
              {isAdmin && (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <EyeOff className="w-5 h-5 text-red-400" />
                      <h3 className="text-red-400 font-semibold">Redaction Controls</h3>
                    </div>
                    <Badge className="bg-red-500/20 text-red-400 border-red-500/50">
                      Admin Only
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-400 mb-4">
                    Toggle redaction for sensitive fields. Redacted fields will be hidden from non-admin viewers.
                  </p>
                  
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {[
                      { field: 'client_name', label: 'Client Name' },
                      { field: 'client_email', label: 'Client Email' },
                      { field: 'phone_number', label: 'Phone Number' },
                      { field: 'address', label: 'Address' },
                      { field: 'victim_wallet', label: 'Victim Wallet' },
                      { field: 'scammer_wallet', label: 'Scammer Wallet' },
                      { field: 'cryptocurrency', label: 'Cryptocurrency' },
                      { field: 'suspect_name', label: 'Suspect Name' },
                      { field: 'suspect_email', label: 'Suspect Email' },
                      { field: 'suspect_phone', label: 'Suspect Phone' },
                    ].map(({ field, label }) => (
                      <button
                        key={field}
                        onClick={async () => {
                          const currentRedacted = caseData.redacted_fields || [];
                          const newRedacted = currentRedacted.includes(field)
                            ? currentRedacted.filter(f => f !== field)
                            : [...currentRedacted, field];
                          
                          await updateCaseMutation.mutateAsync({
                            redacted_fields: newRedacted,
                            last_activity: new Date().toISOString()
                          });
                        }}
                        className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                          (caseData.redacted_fields || []).includes(field)
                            ? 'bg-red-500/20 border-red-500/50 text-red-400'
                            : 'bg-gray-900/50 border-gray-700 text-gray-300 hover:border-gray-600'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {(caseData.redacted_fields || []).includes(field) ? (
                            <EyeOff className="w-3 h-3" />
                          ) : (
                            <Eye className="w-3 h-3" />
                          )}
                          <span>{label}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                  
                  {(caseData.redacted_fields || []).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-red-500/20">
                      <p className="text-xs text-gray-400">
                        {(caseData.redacted_fields || []).length} field(s) currently redacted
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Quick Actions Panel */}
              <QuickActionsPanel 
                  caseData={liveCase} 
                  onUpdate={onUpdate}
                  onOpenResponse={() => setActiveTab('communications')}
                  onOpenTracking={() => setActiveTab('tracking')}
              />

              {/* Consolidated AI Investigation Hub */}
              <InvestigationAICenter caseData={liveCase} onUpdate={onUpdate} />

              {/* AI Priority Badge */}
              {caseData.priority_score && (
                <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-purple-400" />
                    <span className="text-white font-medium">AI Priority Assessment</span>
                  </div>
                  <AIPriorityBadge score={caseData.priority_score} />
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-4 bg-[#0f1419] rounded-lg border border-cyan-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-cyan-400" />
                    <p className="text-xs text-gray-300 font-medium">Victim Details</p>
                  </div>
                  <div className="space-y-1">
                      <SensitiveField 
                          field="client_name" 
                          value={caseData.client_name || caseData.victim_name || 'N/A'} 
                          caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                      />
                      <SensitiveField 
                          field="client_email" 
                          value={[caseData.client_email, caseData.victim_email].find(e => e && typeof e === 'string' && !e.includes('no-reply.base44.com') && !e.startsWith('service+')) || ''} 
                          icon={Mail}
                          caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                      />
                      <SensitiveField 
                          field="phone_number" 
                          value={caseData.phone_number || caseData.victim_phone || ''} 
                          icon={Phone}
                          caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                      />
                      {caseData.address_information && (
                          <div className="pt-1 mt-1 border-t border-cyan-500/10">
                              <p className="text-xs text-gray-400 mb-1">Address</p>
                              <SensitiveField 
                                  field="address" 
                                  value={[
                                      caseData.address_information.street_address,
                                      caseData.address_information.apartment_unit,
                                      caseData.address_information.city,
                                      caseData.address_information.state_province,
                                      caseData.address_information.zip_postal_code,
                                      caseData.address_information.country
                                  ].filter(Boolean).join(', ') || 'N/A'} 
                                  icon={MapPin}
                                  caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                              />
                          </div>
                      )}
                      {caseData.victim_wallet && (
                          <div className="pt-1 mt-1 border-t border-cyan-500/10">
                              <SensitiveField 
                                  field="victim_wallet" 
                                  value={caseData.victim_wallet} 
                                  label="Victim Wallet"
                                  icon={Shield}
                                  caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                              />
                          </div>
                      )}
                  </div>
                </div>

                <div className="p-4 bg-[#0f1419] rounded-lg border border-purple-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-purple-400" />
                    <p className="text-xs text-gray-300 font-medium">Created By</p>
                  </div>
                  <p className="text-white font-semibold text-base">{[caseData.created_by_name, caseData.client_name].find(e => e && typeof e === 'string' && !e.trim().toLowerCase().startsWith('service+') && !e.toLowerCase().includes('no-reply.base44.com') && !e.toLowerCase().includes('base44.com')) || 'N/A'}</p>
                  <p className="text-xs text-gray-400 mt-1">{[caseData.client_email, caseData.victim_email, caseData.created_by_email, caseData.created_by].find(e => e && typeof e === 'string' && !e.trim().toLowerCase().startsWith('service+') && !e.toLowerCase().includes('no-reply.base44.com') && !e.toLowerCase().includes('base44.com')) || 'Unknown User'}</p>
                </div>

                <div className="p-4 bg-[#0f1419] rounded-lg border border-cyan-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-cyan-400" />
                    <p className="text-xs text-gray-300 font-medium">Amount Stolen</p>
                  </div>
                  <p className="text-2xl font-bold text-red-400">
                    ${(caseData.amount_lost || caseData.amount_stolen_usd || 0).toLocaleString()}
                  </p>
                  {caseData.cryptocurrency && (
                      <div className="mt-1">
                          <SensitiveField 
                              field="cryptocurrency" 
                              value={caseData.cryptocurrency} 
                              label="Crypto"
                              caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                          />
                      </div>
                  )}
                  {caseData.scammer_wallet && (
                      <div className="mt-2 pt-2 border-t border-cyan-500/10">
                          <SensitiveField 
                              field="scammer_wallet" 
                              value={caseData.scammer_wallet} 
                              label="Scammer Wallet"
                              caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                          />
                      </div>
                  )}
                </div>

                <div className="p-4 bg-[#0f1419] rounded-lg border border-cyan-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-cyan-400" />
                    <p className="text-xs text-gray-300 font-medium">Incident Date</p>
                  </div>
                  <p className="text-white font-semibold text-base">
                    {(caseData.incident_date || caseData.incident_timestamp) ? 
                      new Date(caseData.incident_date || caseData.incident_timestamp).toLocaleString() : 'N/A'}
                  </p>
                </div>

                <div className="p-4 bg-[#0f1419] rounded-lg border border-green-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                    <p className="text-xs text-gray-300 font-medium">Recovered</p>
                  </div>
                  <p className="text-2xl font-bold text-green-400">
                    ${caseData.recovery_amount?.toLocaleString() || 0}
                  </p>
                </div>
              </div>

              {caseData.description && (
                <div className="p-4 bg-[#0f1419] rounded-lg border border-cyan-500/20">
                  <p className="text-xs text-gray-300 mb-2 font-medium">Case Description</p>
                  {editing ? (
                    <Textarea
                      value={editedCase.description}
                      onChange={(e) => setEditedCase({...editedCase, description: e.target.value})}
                      className="bg-[#1a2332] border-cyan-500/30 text-white min-h-[100px]"
                    />
                  ) : (
                    <p className="text-white text-sm leading-relaxed">{caseData.description}</p>
                  )}
                </div>
              )}

              {(caseData.ic3_complaint_number || caseData.federal_case_number) && (
                <div className="grid grid-cols-2 gap-4">
                  {caseData.ic3_complaint_number && (
                    <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                      <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/50 mb-2">IC3</Badge>
                      <p className="text-white font-mono">{caseData.ic3_complaint_number}</p>
                    </div>
                  )}
                  {caseData.federal_case_number && (
                    <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                      <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/50 mb-2">Federal</Badge>
                      <p className="text-white font-mono">{caseData.federal_case_number}</p>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* AI INSIGHTS TAB */}
            <TabsContent value="ai-insights" className="space-y-4">
              <AIFraudInsights caseData={liveCase} onUpdate={onUpdate} />
              
              {/* Automated Reports Section */}
              <div className="pt-6 border-t border-purple-500/20">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-cyan-400" />
                  AI-Generated Reports
                </h3>
                <AutomatedReportGenerator caseData={liveCase} onReportGenerated={onUpdate} />
              </div>
            </TabsContent>

            {/* AI HUB TAB - Consolidated investigation AI orchestration */}
            <TabsContent value="ai-hub" className="space-y-4">
              <InvestigationAICenter caseData={liveCase} onUpdate={onUpdate} />
              <AIFraudInsights caseData={liveCase} onUpdate={onUpdate} />
              <WalletRiskChecker caseData={liveCase} onWalletChecked={() => onUpdate?.()} />
            </TabsContent>

            {/* EDIT TAB - Full Admin Case Editing */}
            <TabsContent value="edit" className="space-y-6">
              <div className="p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-lg mb-4">
                <h3 className="text-cyan-400 font-semibold flex items-center gap-2">
                  <Edit className="w-5 h-5" />
                  Edit Case Details
                </h3>
                <p className="text-gray-400 text-sm mt-1">Make changes to the case and click Update to save.</p>
              </div>

              {/* Case Info Section */}
              <div className="mb-4">
                 <Label className="text-gray-300 mb-2 block">SafeNestT Case Number</Label>
                 <div className="flex gap-2">
                    <Input
                        value={editedCase.case_number || ''}
                        onChange={(e) => setEditedCase({...editedCase, case_number: e.target.value})}
                        placeholder="SN-YYYY-XXXXX"
                        className="bg-[#1a2332] border-cyan-500/20 text-cyan-400 font-mono font-bold"
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title="Generate Random ID"
                        onClick={() => setEditedCase({...editedCase, case_number: `SN-${new Date().getFullYear()}-${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`})}
                        className="border-cyan-500/20 text-cyan-400 shrink-0"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </Button>
                 </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-300 mb-2 block">Case Title *</Label>
                  <Input
                    value={editedCase.case_title}
                    onChange={(e) => setEditedCase({...editedCase, case_title: e.target.value})}
                    className="bg-[#0f1419] border-cyan-500/30 text-white"
                    placeholder="Enter case title"
                  />
                </div>
                <div>
                  <Label className="text-gray-300 mb-2 block">Status *</Label>
                  <Select 
                    value={editedCase.status} 
                    onValueChange={(v) => setEditedCase({...editedCase, status: v})}
                  >
                    <SelectTrigger className="bg-[#0f1419] border-cyan-500/30 text-white">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="In Review">In Review</SelectItem>
                      <SelectItem value="investigating">Investigating</SelectItem>
                      <SelectItem value="In Progress">In Progress</SelectItem>
                      <SelectItem value="documented">Documented</SelectItem>
                      <SelectItem value="submitted">Submitted</SelectItem>
                      <SelectItem value="law_enforcement">Law Enforcement</SelectItem>
                      <SelectItem value="Called">Called</SelectItem>
                      <SelectItem value="recovering">Recovering</SelectItem>
                      <SelectItem value="recovered">Recovered</SelectItem>
                      <SelectItem value="Resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Client/Victim Info */}
              <div className="p-4 bg-[#0f1419] rounded-lg border border-cyan-500/20">
                <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <User className="w-4 h-4 text-cyan-400" />
                  Client / Victim Information
                </h4>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-300 mb-2 block">Client Name *</Label>
                    <Input
                      value={editedCase.client_name}
                      onChange={(e) => setEditedCase({...editedCase, client_name: e.target.value})}
                      className="bg-[#1a2332] border-cyan-500/30 text-white"
                      placeholder="Enter client name"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 mb-2 block">Contact Email</Label>
                    <Input
                      type="email"
                      value={editedCase.client_email}
                      onChange={(e) => setEditedCase({...editedCase, client_email: e.target.value})}
                      className="bg-[#1a2332] border-cyan-500/30 text-white"
                      placeholder="Enter email"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 mb-2 block">Contact Phone</Label>
                    <Input
                      value={editedCase.phone_number}
                      onChange={(e) => setEditedCase({...editedCase, phone_number: e.target.value})}
                      className="bg-[#1a2332] border-cyan-500/30 text-white"
                      placeholder="Enter phone"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 mb-2 block">Urgency</Label>
                    <Select 
                      value={editedCase.urgency} 
                      onValueChange={(v) => setEditedCase({...editedCase, urgency: v})}
                    >
                      <SelectTrigger className="bg-[#1a2332] border-cyan-500/30 text-white">
                        <SelectValue placeholder="Select urgency" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Low">Low</SelectItem>
                        <SelectItem value="Medium">Medium</SelectItem>
                        <SelectItem value="High">High</SelectItem>
                        <SelectItem value="Critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Address Section */}
                <div className="mt-6 pt-6 border-t border-cyan-500/10">
                  <h5 className="text-white font-medium mb-3 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-cyan-400" />
                    Address Information (Optional)
                  </h5>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <Label className="text-gray-300 mb-2 block">Street Address</Label>
                      <Input
                        value={editedCase.address_information?.street_address || ''}
                        onChange={(e) => setEditedCase({
                          ...editedCase, 
                          address_information: {
                            ...editedCase.address_information,
                            street_address: e.target.value
                          }
                        })}
                        className="bg-[#1a2332] border-cyan-500/30 text-white"
                        placeholder="Enter street address"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300 mb-2 block">Apartment / Unit</Label>
                      <Input
                        value={editedCase.address_information?.apartment_unit || ''}
                        onChange={(e) => setEditedCase({
                          ...editedCase, 
                          address_information: {
                            ...editedCase.address_information,
                            apartment_unit: e.target.value
                          }
                        })}
                        className="bg-[#1a2332] border-cyan-500/30 text-white"
                        placeholder="Apt, Suite, etc."
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300 mb-2 block">City</Label>
                      <Input
                        value={editedCase.address_information?.city || ''}
                        onChange={(e) => setEditedCase({
                          ...editedCase, 
                          address_information: {
                            ...editedCase.address_information,
                            city: e.target.value
                          }
                        })}
                        className="bg-[#1a2332] border-cyan-500/30 text-white"
                        placeholder="Enter city"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300 mb-2 block">State / Province</Label>
                      <Input
                        value={editedCase.address_information?.state_province || ''}
                        onChange={(e) => setEditedCase({
                          ...editedCase, 
                          address_information: {
                            ...editedCase.address_information,
                            state_province: e.target.value
                          }
                        })}
                        className="bg-[#1a2332] border-cyan-500/30 text-white"
                        placeholder="State or Province"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300 mb-2 block">ZIP / Postal Code</Label>
                      <Input
                        value={editedCase.address_information?.zip_postal_code || ''}
                        onChange={(e) => setEditedCase({
                          ...editedCase, 
                          address_information: {
                            ...editedCase.address_information,
                            zip_postal_code: e.target.value
                          }
                        })}
                        className="bg-[#1a2332] border-cyan-500/30 text-white"
                        placeholder="ZIP or Postal Code"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300 mb-2 block">Country</Label>
                      <Input
                        value={editedCase.address_information?.country || ''}
                        onChange={(e) => setEditedCase({
                          ...editedCase, 
                          address_information: {
                            ...editedCase.address_information,
                            country: e.target.value
                          }
                        })}
                        className="bg-[#1a2332] border-cyan-500/30 text-white"
                        placeholder="Country"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Financial Info */}
              <div className="p-4 bg-[#0f1419] rounded-lg border border-cyan-500/20">
                <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-cyan-400" />
                  Financial Information
                </h4>
                <div className="grid md:grid-cols-3 gap-4 mb-6">
                  <div>
                    <Label className="text-gray-300 mb-2 block">Total Amount Stolen (USD)</Label>
                    <Input
                      type="number"
                      value={editedCase.amount_lost}
                      onChange={(e) => setEditedCase({...editedCase, amount_lost: e.target.value})}
                      className="bg-[#1a2332] border-cyan-500/30 text-white"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 mb-2 block">Recovery Amount (USD)</Label>
                    <Input
                      type="number"
                      value={editedCase.recovery_amount}
                      onChange={(e) => setEditedCase({...editedCase, recovery_amount: e.target.value})}
                      className="bg-[#1a2332] border-cyan-500/30 text-white"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 mb-2 block">Cryptocurrency</Label>
                    <Input
                      value={editedCase.cryptocurrency}
                      onChange={(e) => setEditedCase({...editedCase, cryptocurrency: e.target.value})}
                      className="bg-[#1a2332] border-cyan-500/30 text-white"
                      placeholder="BTC, ETH, USDT..."
                    />
                  </div>
                </div>

                {/* Payment Transactions Editor */}
                <div className="pt-6 border-t border-cyan-500/10">
                  <TransactionsList 
                    transactions={editedCase.payment_transactions || caseData.payment_transactions || []}
                    onChange={(txs) => setEditedCase({...editedCase, payment_transactions: txs})}
                  />
                </div>
              </div>

              {/* Wallet Info */}
              <div className="p-4 bg-[#0f1419] rounded-lg border border-cyan-500/20">
              <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Shield className="w-4 h-4 text-cyan-400" />
                Wallet & Blockchain
              </h4>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Label className="text-gray-300 mb-2 block">Victim Wallet Address</Label>
                  <Input
                    value={editedCase.victim_wallet}
                    onChange={(e) => setEditedCase({...editedCase, victim_wallet: e.target.value})}
                    className="bg-[#1a2332] border-cyan-500/30 text-white font-mono text-sm"
                    placeholder="Enter victim's wallet address"
                  />
                </div>
                <div>
                  <Label className="text-gray-300 mb-2 block">Blockchain</Label>
                    <Select 
                      value={editedCase.blockchain || ''} 
                      onValueChange={(v) => setEditedCase({...editedCase, blockchain: v})}
                    >
                      <SelectTrigger className="bg-[#1a2332] border-cyan-500/30 text-white">
                        <SelectValue placeholder="Select blockchain" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ethereum">Ethereum</SelectItem>
                        <SelectItem value="bitcoin">Bitcoin</SelectItem>
                        <SelectItem value="bsc">BSC</SelectItem>
                        <SelectItem value="polygon">Polygon</SelectItem>
                        <SelectItem value="solana">Solana</SelectItem>
                        <SelectItem value="tron">Tron</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-gray-300 mb-2 block">Scammer Wallet Address</Label>
                    <Input
                      value={editedCase.scammer_info?.wallet_addresses?.[0] || ''}
                      onChange={(e) => setEditedCase({
                        ...editedCase, 
                        scammer_info: { 
                          ...editedCase.scammer_info, 
                          wallet_addresses: [e.target.value] 
                        },
                        monitored_wallets: e.target.value ? [e.target.value] : []
                      })}
                      className="bg-[#1a2332] border-cyan-500/30 text-white font-mono text-sm"
                      placeholder="0x..."
                    />
                  </div>
                </div>
              </div>

              {/* Reference Numbers */}
              <div className="p-4 bg-[#0f1419] rounded-lg border border-cyan-500/20">
                <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-cyan-400" />
                  Reference Numbers
                </h4>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-300 mb-2 block">IC3 Complaint Number</Label>
                    <Input
                      value={editedCase.ic3_complaint_number}
                      onChange={(e) => setEditedCase({...editedCase, ic3_complaint_number: e.target.value})}
                      className="bg-[#1a2332] border-cyan-500/30 text-white"
                      placeholder="Enter IC3 number"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 mb-2 block">Federal Case Number</Label>
                    <Input
                      value={editedCase.federal_case_number}
                      onChange={(e) => setEditedCase({...editedCase, federal_case_number: e.target.value})}
                      className="bg-[#1a2332] border-cyan-500/30 text-white"
                      placeholder="Enter federal case number"
                    />
                  </div>
                </div>
              </div>

              {/* Progress */}
              <div className="p-4 bg-[#0f1419] rounded-lg border border-cyan-500/20">
                <h4 className="text-white font-semibold mb-4">Investigation Progress</h4>
                <div className="flex items-center gap-4">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={editedCase.investigation_progress}
                    onChange={(e) => setEditedCase({...editedCase, investigation_progress: e.target.value})}
                    className="w-24 bg-[#1a2332] border-cyan-500/30 text-white"
                  />
                  <span className="text-gray-300">%</span>
                  <div className="flex-1 bg-gray-700 rounded-full h-3">
                    <div
                      className="h-3 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all"
                      style={{ width: `${editedCase.investigation_progress || 0}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Law Enforcement Authorization - Editable */}
              <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <h4 className="text-purple-400 font-semibold mb-4 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Law Enforcement Authorization
                </h4>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="le_auth"
                      checked={editedCase.law_enforcement_authorization?.authorized || false}
                      onChange={(e) => setEditedCase({
                        ...editedCase,
                        law_enforcement_authorization: {
                          ...editedCase.law_enforcement_authorization,
                          authorized: e.target.checked,
                          authorized_date: e.target.checked ? new Date().toISOString() : null
                        }
                      })}
                      className="w-4 h-4 rounded border-purple-500/50 bg-[#1a2332]"
                    />
                    <Label htmlFor="le_auth" className="text-white cursor-pointer">Authorized by Client</Label>
                  </div>
                  
                  {editedCase.law_enforcement_authorization?.authorized && (
                    <>
                      <div>
                        <Label className="text-gray-300 mb-2 block">Full Legal Name (Signature)</Label>
                        <Input
                          value={editedCase.law_enforcement_authorization?.full_name || ''}
                          onChange={(e) => setEditedCase({
                            ...editedCase,
                            law_enforcement_authorization: {
                              ...editedCase.law_enforcement_authorization,
                              full_name: e.target.value
                            }
                          })}
                          className="bg-[#1a2332] border-purple-500/30 text-white"
                          placeholder="Enter full legal name"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Label className="text-gray-300 mb-2 block">Authorized Agencies (comma separated)</Label>
                        <Input
                          value={editedCase.law_enforcement_authorization?.agencies?.join(', ') || 'FBI, IC3, FTC'}
                          onChange={(e) => setEditedCase({
                            ...editedCase,
                            law_enforcement_authorization: {
                              ...editedCase.law_enforcement_authorization,
                              agencies: e.target.value.split(',').map(s => s.trim())
                            }
                          })}
                          className="bg-[#1a2332] border-purple-500/30 text-white"
                          placeholder="FBI, IC3, FTC, Local Police"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div>
                <Label className="text-gray-300 mb-2 block">Case Notes / Description</Label>
                <Textarea
                  value={editedCase.description}
                  onChange={(e) => setEditedCase({...editedCase, description: e.target.value})}
                  className="bg-[#0f1419] border-cyan-500/30 text-white min-h-[150px]"
                  placeholder="Enter detailed notes about the case..."
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-cyan-500/20">
                <Button
                  variant="outline"
                  onClick={() => setActiveTab('overview')}
                  className="border-gray-500/30"
                >
                  Cancel
                </Button>
                <Button
                  onClick={saveEdits}
                  disabled={saving}
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 min-w-[150px]"
                >
                  {saving ? (
                    <><span className="animate-spin mr-2">⏳</span>Saving...</>
                  ) : (
                    <><Save className="w-4 h-4 mr-2" />Update Case</>
                  )}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="documents" className="space-y-4">
              <CaseDocuments caseData={caseData} onUpdate={onUpdate} />
            </TabsContent>

            <TabsContent value="shared-files" className="space-y-4">
              <SharedFilesPanel 
                caseId={caseData.id}
                caseData={caseData}
                isAdmin={true}
                currentUser={user}
              />
            </TabsContent>

            <TabsContent value="victim" className="space-y-4">
              <h3 className="text-white font-semibold text-lg">Client Contact Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-[#0f1419] rounded-lg border border-cyan-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <User className="w-5 h-5 text-cyan-400" />
                    <p className="text-sm text-gray-300 font-medium">Primary Contact</p>
                  </div>
                  <div className="space-y-2">
                    <SensitiveField 
                        field="client_name" 
                        value={caseData.client_name || caseData.victim_name || 'N/A'} 
                        label="Name"
                        caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                    />
                    <SensitiveField 
                        field="client_email" 
                        value={caseData.client_email || caseData.victim_email || 'N/A'} 
                        icon={Mail}
                        label="Email"
                        caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                    />
                    <SensitiveField 
                        field="phone_number" 
                        value={caseData.phone_number || caseData.victim_phone || 'N/A'} 
                        icon={Phone}
                        label="Phone"
                        caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                    />
                    {caseData.victim_contact_info?.address && (
                      <SensitiveField 
                          field="address" 
                          value={caseData.victim_contact_info.address} 
                          icon={MapPin}
                          label="Address"
                          caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                      />
                    )}
                  </div>
                </div>

                {caseData.victim_contact_info?.emergency_contact && (
                  <div className="p-4 bg-[#0f1419] rounded-lg border border-orange-500/20">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle className="w-5 h-5 text-orange-400" />
                      <p className="text-sm text-gray-300 font-medium">Emergency Contact</p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-white">{caseData.victim_contact_info.emergency_contact.name}</p>
                      <p className="text-gray-300 text-sm">{caseData.victim_contact_info.emergency_contact.phone}</p>
                      <p className="text-gray-400 text-xs">{caseData.victim_contact_info.emergency_contact.relationship}</p>
                    </div>
                  </div>
                )}

              </div>

              {/* Payment Transactions Display */}
              {caseData.payment_transactions && caseData.payment_transactions.length > 0 && (
                <div className="md:col-span-2">
                  <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-cyan-400" />
                    Payment History
                  </h4>
                  <PaymentTransactionsView 
                    transactions={caseData.payment_transactions}
                    totalAmount={caseData.amount_lost}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="suspect" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold text-lg">Suspect Information</h3>
                <Button
                  size="sm"
                  onClick={() => setActiveTab('edit-suspect')}
                  className="bg-red-500/20 text-red-400 hover:bg-red-500/30"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Add / Edit Suspect Info
                </Button>
              </div>
              {caseData.suspect_details || caseData.scammer_info ? (
                <div className="space-y-4">
                  <div className="p-4 bg-[#0f1419] rounded-lg border border-red-500/20">
                    <p className="text-red-400 font-semibold mb-3">Primary Suspect</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {(caseData.suspect_details?.primary_suspect?.name || caseData.scammer_info?.name) && (
                        <SensitiveField 
                            field="suspect_name" 
                            value={caseData.suspect_details?.primary_suspect?.name || caseData.scammer_info?.name} 
                            label="Name"
                            caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                        />
                      )}
                      {(caseData.suspect_details?.primary_suspect?.email || caseData.scammer_info?.email) && (
                        <SensitiveField 
                            field="suspect_email" 
                            value={caseData.suspect_details?.primary_suspect?.email || caseData.scammer_info?.email} 
                            label="Email"
                            caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                        />
                      )}
                      {(caseData.suspect_details?.primary_suspect?.phone || caseData.scammer_info?.phone) && (
                         <SensitiveField 
                            field="suspect_phone" 
                            value={caseData.suspect_details?.primary_suspect?.phone || caseData.scammer_info?.phone} 
                            label="Phone / Contact"
                            caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                        />
                      )}
                      {(caseData.suspect_details?.primary_suspect?.location || caseData.scammer_info?.location) && (
                         <SensitiveField 
                            field="suspect_location" 
                            value={caseData.suspect_details?.primary_suspect?.location || caseData.scammer_info?.location} 
                            label="Location"
                            caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                        />
                      )}
                      {(caseData.suspect_details?.wallet_addresses || caseData.scammer_info?.wallet_addresses)?.length > 0 && (
                        <div className="md:col-span-2 space-y-2">
                          <p className="text-xs text-gray-400 mb-2">Wallet Addresses</p>
                          {(caseData.suspect_details?.wallet_addresses || caseData.scammer_info?.wallet_addresses || []).map((wallet, idx) => (
                            <SensitiveField 
                                key={idx}
                                field={`suspect_wallet_${idx}`} 
                                value={wallet} 
                                caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                            />
                          ))}
                        </div>
                      )}
                      {caseData.scammer_info?.notes && (
                        <div className="md:col-span-2">
                          <p className="text-xs text-gray-400 mb-1">Notes</p>
                          <p className="text-white text-sm">{caseData.scammer_info.notes}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Known Emails */}
                  {caseData.scammer_info?.known_emails?.length > 0 && (
                    <div className="p-4 bg-[#0f1419] rounded-lg border border-orange-500/20">
                      <p className="text-orange-400 font-semibold mb-3">Known Emails</p>
                      <div className="flex flex-wrap gap-2">
                        {caseData.scammer_info.known_emails.map((email, idx) => (
                            <div key={idx}>
                                {isAdmin || !isFieldRedacted(`known_email_${idx}`) ? (
                                    <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/50">
                                        {email}
                                    </Badge>
                                ) : (
                                    <Badge className="bg-red-500/20 text-red-400 border-red-500/50 font-mono">
                                        [REDACTED]
                                    </Badge>
                                )}
                            </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Social Media */}
                  {(caseData.scammer_info?.social_media || caseData.suspect_details?.social_profiles)?.length > 0 && (
                    <div className="p-4 bg-[#0f1419] rounded-lg border border-purple-500/20">
                      <p className="text-purple-400 font-semibold mb-3">Social Media / Online Presence</p>
                      <div className="space-y-2">
                        {(caseData.scammer_info?.social_media || caseData.suspect_details?.social_profiles || []).map((profile, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">{typeof profile === 'string' ? 'Link' : profile.platform}</Badge>
                            <SensitiveField 
                                field={`social_${idx}`} 
                                value={typeof profile === 'string' ? profile : (profile.url || profile.profile)} 
                                caseData={caseData} onUpdate={onUpdate} isAdmin={isAdmin}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 bg-[#0f1419] rounded-lg border border-red-500/10">
                  <AlertCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400 mb-4">No suspect details available</p>
                  <Button
                    onClick={() => setActiveTab('edit-suspect')}
                    className="bg-red-500/20 text-red-400 hover:bg-red-500/30"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Suspect Information
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* EDIT SUSPECT TAB */}
            <TabsContent value="edit-suspect" className="space-y-6">
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg mb-4">
                <h3 className="text-red-400 font-semibold flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Add / Edit Suspect Information
                </h3>
                <p className="text-gray-400 text-sm mt-1">Enter all known details about the suspect.</p>
              </div>

              <SuspectEditForm 
              caseData={caseData} 
              onSave={async (suspectData) => {
                setSaving(true);
                try {
                  await updateCaseMutation.mutateAsync({
                    scammer_info: suspectData,
                    // Sync monitored wallets
                    monitored_wallets: [
                      ...(caseData.monitored_wallets || []),
                      ...(suspectData.wallet_addresses || [])
                    ].filter((v, i, a) => a.indexOf(v) === i),
                    last_activity: new Date().toISOString()
                  });

                  toast.success('Suspect information saved successfully!');
                  setActiveTab('suspect');
                } catch (error) {
                  // Error handled in mutation
                }
                setSaving(false);
              }}
              onCancel={() => setActiveTab('suspect')}
              saving={saving}
              />
            </TabsContent>

            {/* NEW Structured Evidence Intake */}
            <TabsContent value="evidence" className="space-y-4">
                <div className="mb-6">
                  <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                    <Upload className="w-5 h-5 text-cyan-400" />
                    Quick Upload Evidence
                  </h3>
                  <MultiFileUploader
                    maxFiles={20}
                    onFilesUploaded={async (uploadedFiles) => {
                      const toastId = toast.loading("Processing evidence files...");
                      try {
                        for (const file of uploadedFiles) {
                          // Create evidence file record
                          const evidenceFile = await base44.entities.CaseEvidenceFile.create({
                            case_id: caseData.id,
                            file_url: file.url,
                            filename: file.name,
                            file_size: file.size,
                            mime_type: file.type,
                            uploader_id: user?.id,
                            case_owner_email: user?.email,
                            uploaded_at: new Date().toISOString(),
                            parse_status: 'PENDING'
                          });

                          // Trigger AI processing
                          await base44.functions.invoke('evidenceProcessing', {
                            action: 'process_upload',
                            data: {
                              caseId: caseData.id,
                              entityName: caseData._entityName || 'MyCase',
                              evidenceFileId: evidenceFile.id,
                              fileUrl: file.url,
                              fileType: file.type,
                              fileName: file.name
                            }
                          });
                        }

                        toast.success(`${uploadedFiles.length} file(s) uploaded and processing`, { id: toastId });
                        if (onUpdate) onUpdate();
                      } catch (error) {
                        toast.error('Failed to process some files', { id: toastId });
                      }
                    }}
                  />
                </div>
                <EvidenceIntake caseId={caseData.id} onUpdate={onUpdate} />
            </TabsContent>

            {/* Legacy Evidence View (for backward compat) */}
            <TabsContent value="legacy-evidence" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold text-lg">Raw File Log</h3>
                <div>
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      className="hidden" 
                      onChange={handleFileUpload} 
                      disabled={uploading} 
                    />
                    <Button 
                      size="sm" 
                      disabled={uploading} 
                      onClick={() => fileInputRef.current?.click()}
                      className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 cursor-pointer"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {uploading ? "Uploading..." : "Upload Evidence"}
                    </Button>
                </div>
              </div>

              {(caseData.evidence_log || caseData.evidence_files)?.length > 0 ? (
                <div className="grid gap-2">
                  {(caseData.evidence_log || caseData.evidence_files || []).map((item, idx) => (
                    <div key={idx} className="p-3 bg-[#0f1419] rounded-lg border border-cyan-500/20 hover:border-cyan-500/40 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-cyan-400" />
                          <div>
                            <p className="text-white text-sm font-medium">{item.description || item.name}</p>
                            <p className="text-xs text-gray-300">
                              {new Date(item.timestamp || item.uploaded_date).toLocaleString()}
                              {item.verified && <Badge className="ml-2 bg-green-500/20 text-green-400 text-xs">Verified</Badge>}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button 
                                size="sm" 
                                variant="ghost" 
                                onClick={() => setPreviewFile(item)}
                                className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/30"
                            >
                                <Eye className="w-4 h-4 mr-2" />
                                View Analysis
                            </Button>
                            
                            <Button size="sm" variant="ghost" onClick={() => window.open(item.file_url || item.url, '_blank')} title="Download File">
                                <ExternalLink className="w-4 h-4 text-gray-400" />
                            </Button>
                        </div>
                      </div>
                      
                      {/* Intelligence Summary Display */}
                      {item.summary?.analysis_text && (
                        <div className="mt-2 p-3 bg-blue-900/20 rounded border border-blue-500/20 text-xs">
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-semibold text-blue-400 flex items-center gap-1">
                                    <Shield className="w-3 h-3" /> Intelligence Summary
                                </span>
                                {item.summary.match_reported && (
                                    <Badge className="bg-red-500/20 text-red-400 text-[10px] border-red-500/50">MATCH FOUND</Badge>
                                )}
                            </div>
                            <pre className="whitespace-pre-wrap font-sans text-gray-300">
                                {item.summary.analysis_text}
                            </pre>
                            {item.summary.suspect_matches > 0 && (
                                <div className="mt-2 pt-2 border-t border-blue-500/20">
                                    <p className="text-orange-400 font-bold mb-1">Suspect Wallet Correlation</p>
                                    <p className="text-gray-400">
                                        {item.summary.suspect_matches} wallet(s) in this evidence match the Global Suspect Database.
                                    </p>
                                </div>
                            )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 bg-[#0f1419] rounded-lg border border-cyan-500/10">
                  <FileText className="w-12 h-12 text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-400 text-sm">No evidence uploaded yet</p>
                </div>
              )}
              
              <FilePreviewModal 
                file={previewFile} 
                isOpen={!!previewFile} 
                onClose={() => setPreviewFile(null)} 
              />
            </TabsContent>

            <TabsContent value="timeline" className="space-y-4">
              <h3 className="text-white font-semibold text-lg mb-4">Latest Updates & Timeline</h3>
              
              {/* Combine Manual Timeline and System Events */}
              <div className="space-y-4">
                  {/* Fetch CaseTimelineEvents via component or separate query? For now using what's in caseData or fetching fresh if needed. 
                      Ideally we'd fetch the CaseTimelineEvents entity here. 
                      Let's use a small inline query component or just assume caseData has it if we fetched it. 
                      Since CaseDetailDialog caseData might be stale, we rely on the main timeline array or a fresh fetch.
                      We'll assume the timeline array is used for basic events, but we want the new "System Events".
                      Actually, let's just use a dedicated component for the feed to keep this clean.
                  */}
                  <TimelineFeed caseId={caseData.id} initialTimeline={caseData.timeline} />
              </div>
            </TabsContent>

            <TabsContent value="notes" className="space-y-4">
              <InvestigationNotes caseId={caseData.id} caseData={caseData} onUpdate={onUpdate} />
            </TabsContent>

            <TabsContent value="tasks" className="space-y-4">
              <CaseTaskManager caseId={caseData.id} user={user} />
            </TabsContent>

            <TabsContent value="tracking" className="space-y-4">
              {/* AI Wallet Risk Checker */}
              <WalletRiskChecker 
                caseData={liveCase}
                onWalletChecked={(data) => {
                  if (data.analysis?.is_suspicious) {
                    toast.warning('Suspicious wallet - consider adding to monitoring');
                  }
                }}
              />

              <CaseWalletTracer 
                  caseId={liveCase.id || caseData.id} 
                  caseData={liveCase}
                  monitoredWallets={liveCase.monitored_wallets || []}
                  onWalletAdded={async (wallet) => {
                      const newWallets = [...(liveCase.monitored_wallets || []), wallet];
                      await updateCaseMutation.mutateAsync({
                          monitored_wallets: newWallets,
                          last_activity: new Date().toISOString()
                      });
                  }}
              />

              <div className="flex items-center justify-between mt-6 mb-2">
                  <h3 className="text-white font-semibold text-lg">Active Monitoring</h3>
                  <Button 
                      size="sm" 
                      variant="outline" 
                      className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-950"
                      onClick={async () => {
                          const toastId = toast.loading("Scanning blockchain...");
                          try {
                              const res = await base44.functions.invoke('blockchainMonitor', { caseId: liveCase.id || caseData.id });
                              if (res.data.success) {
                                  toast.success(`Scan complete. Found ${res.data.total_new} new transactions.`, { id: toastId });
                                  if (res.data.total_new > 0 && onUpdate) onUpdate();
                              } else {
                                  toast.error("Scan failed", { id: toastId });
                              }
                          } catch (e) {
                              toast.error("Error scanning blockchain", { id: toastId });
                          }
                      }}
                  >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Run Live Monitor
                  </Button>
              </div>
              {liveCase.monitored_wallets?.length > 0 ? (
                <div className="space-y-2">
                  {liveCase.monitored_wallets.map((wallet, idx) => (
                    <div key={idx} className="p-3 bg-[#0f1419] rounded-lg border border-cyan-500/20 flex justify-between items-center">
                      <p className="text-white font-mono text-sm">{wallet}</p>
                      <Badge className="bg-green-500/10 text-green-400 border-green-500/20">Active Monitoring</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-center py-4 text-sm italic">No wallets being monitored. Trace and add a wallet above.</p>
              )}
            </TabsContent>

            <TabsContent value="technical-tools" className="space-y-4">
              <TrackingToolsPanel 
                caseId={liveCase.id} 
                caseTitle={liveCase.case_title || 'Case'} 
                caseData={liveCase}
              />
            </TabsContent>

            <TabsContent value="agencies" className="space-y-4">
              <RecommendedAgencies caseData={caseData} />
            </TabsContent>

            <TabsContent value="summary" className="space-y-4">
              <CaseSummaryGenerator caseData={liveCase} onUpdate={onUpdate} />
            </TabsContent>

            <TabsContent value="reports" className="space-y-4">
              <AgencyReportGenerator caseData={caseData} onReportGenerated={onUpdate} />
            </TabsContent>

            <TabsContent value="intel-report" className="space-y-4">
              <CryptoIntelligenceReport caseData={caseData} />
            </TabsContent>

            <TabsContent value="connections" className="space-y-4">
              <RelatedCasesPanel caseId={caseData.id} entityName={caseData._entityName || caseData.entity_name} />
            </TabsContent>

            <TabsContent value="advanced-tools" className="space-y-6">
                <div className="p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-lg">
                    <h3 className="text-indigo-400 font-semibold mb-2 flex items-center gap-2">
                        <Sparkles className="w-5 h-5" />
                        Advanced Investigation Suite
                    </h3>
                    <p className="text-sm text-gray-300 mb-4">
                        Powerful tools for deep blockchain analysis, cross-case correlation, and pattern matching.
                    </p>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="space-y-6">
                            <AdvancedBlockchainViewer 
                                walletAddress={liveCase.scammer_wallet || caseData.scammer_wallet} 
                                blockchain={liveCase.blockchain || caseData.blockchain || 'ethereum'} 
                                caseData={liveCase || caseData}
                            />
                        </div>
                        <div className="space-y-6">
                            <div className="h-[400px]">
                                <CrossCaseCorrelator />
                            </div>
                            <div className="h-[400px]">
                                <PatternLibrary />
                            </div>
                        </div>
                    </div>
                </div>
            </TabsContent>

            <TabsContent value="communications" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-4">
                      {/* Client Communication Portal */}
                      <div className="p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-lg">
                          <h3 className="text-purple-400 font-semibold mb-2 flex items-center gap-2">
                              <MessageSquare className="w-5 h-5" />
                              Client Communication Portal
                          </h3>
                          <p className="text-sm text-gray-300 mb-4">
                              Secure messaging with the case owner. All messages are logged to timeline.
                          </p>
                          <SecureMessenger 
                              caseId={caseData.id}
                              caseData={caseData}
                              currentUser={user}
                              isAdmin={true}
                          />
                      </div>

                      {/* Internal Team Communication Log */}
                      <div className="h-full overflow-y-auto pr-2 custom-scrollbar">
                          <CommunicationLog caseId={caseData.id} user={user} />
                      </div>
                  </div>
                  <div className="h-full overflow-y-auto pr-2 custom-scrollbar">
                      <ResponseTemplates caseData={caseData} />
                  </div>
              </div>
            </TabsContent>

            <TabsContent value="cyber-profile" className="space-y-4">
              <CyberFraudProfileBuilder caseId={caseData.id} caseData={caseData} />
            </TabsContent>
            </Tabs>
            </div>
            </DialogContent>
            </Dialog>
            );
            }