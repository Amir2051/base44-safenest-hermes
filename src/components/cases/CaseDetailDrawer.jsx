import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Clock, User, Mail, Phone, Save, Loader2, Trash2, MessageSquare, FileText, Brain, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";

export default function CaseDetailDrawer({ caseId, isOpen, onClose }) {
  const [editedCase, setEditedCase] = useState(null);
  const queryClient = useQueryClient();

  const { data: caseData, isLoading } = useQuery({
    queryKey: ['client-case', caseId],
    queryFn: async () => {
        // Using list with filter since get(id) might not be standard in all Base44 versions or to be safe
        const res = await base44.entities.ClientCase.list();
        return res.find(c => c.id === caseId);
    },
    enabled: !!caseId && isOpen
  });

  useEffect(() => {
    if (caseData) {
      setEditedCase(caseData);
    }
  }, [caseData]);

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.ClientCase.update(caseId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-cases'] });
      queryClient.invalidateQueries({ queryKey: ['client-case', caseId] });
      toast.success("Case updated");
      trackEvent('case_updated', { event_category: 'cases' });
    },
    onError: (err) => toast.error("Failed to update: " + err.message)
  });

  const handleSave = () => {
    if (editedCase) {
      updateMutation.mutate(editedCase);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-[#1a2332] border-l border-gray-700 shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="p-6 border-b border-gray-700 flex justify-between items-center bg-[#0f1419]">
              <div>
                <h2 className="text-xl font-bold text-white">Case Details</h2>
                <p className="text-sm text-gray-400 font-mono">{caseId}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {isLoading || !editedCase ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                </div>
              ) : (
                <>
                  {/* AI Priority Section */}
                  {editedCase.priority_score !== undefined && (
                    <div className="mb-6 p-4 bg-gradient-to-r from-blue-900/20 to-purple-900/20 rounded-lg border border-blue-500/30">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Brain className="w-5 h-5 text-purple-400" />
                          <h3 className="text-base font-bold text-white">AI Priority Analysis</h3>
                        </div>
                        <div className={`px-3 py-1 rounded-full border font-bold text-sm ${
                          editedCase.priority_score >= 80 ? 'bg-red-500/20 text-red-400 border-red-500/50' : 
                          editedCase.priority_score >= 50 ? 'bg-orange-500/20 text-orange-400 border-orange-500/50' : 
                          'bg-blue-500/20 text-blue-400 border-blue-500/50'
                        }`}>
                          Score: {editedCase.priority_score}/100
                        </div>
                      </div>
                      
                      {editedCase.ai_analysis && (
                        <div className="flex gap-3">
                          <Sparkles className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-1" />
                          <p className="text-sm text-gray-300 leading-relaxed">
                            {editedCase.ai_analysis}
                          </p>
                        </div>
                      )}

                      <div className="mt-3 flex justify-end">
                         <Button 
                            size="sm" 
                            variant="ghost" 
                            className="text-xs text-purple-400 hover:bg-purple-500/10 h-7"
                            onClick={() => {
                               base44.functions.invoke('casePrioritization', { case_id: editedCase.id })
                               .then((res) => {
                                  toast.success("Re-analysis complete");
                                  setEditedCase({...editedCase, priority_score: res.data.score, ai_analysis: res.data.analysis});
                                  queryClient.invalidateQueries({ queryKey: ['client-cases'] });
                               })
                               .catch(err => toast.error("Analysis failed"));
                            }}
                         >
                            <Sparkles className="w-3 h-3 mr-1" /> Re-analyze
                         </Button>
                      </div>
                    </div>
                  )}

                  {/* Status & Urgency */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Status</label>
                      <Select 
                        value={editedCase.status} 
                        onValueChange={(val) => setEditedCase({...editedCase, status: val})}
                      >
                        <SelectTrigger className="bg-[#0f1419] border-gray-600 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Pending">Pending</SelectItem>
                          <SelectItem value="In Progress">In Progress</SelectItem>
                          <SelectItem value="Called">Called</SelectItem>
                          <SelectItem value="Resolved">Resolved</SelectItem>
                          <SelectItem value="Closed">Closed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Urgency</label>
                      <Select 
                        value={editedCase.urgency} 
                        onValueChange={(val) => setEditedCase({...editedCase, urgency: val})}
                      >
                        <SelectTrigger className="bg-[#0f1419] border-gray-600 text-white">
                          <SelectValue />
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

                  {/* Client Info */}
                  <div className="p-4 bg-[#0f1419] rounded-lg border border-gray-700 space-y-4">
                    <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                      <User className="w-4 h-4" /> Client Information
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs text-gray-500">Full Name</label>
                        <Input 
                          value={editedCase.client_name} 
                          onChange={e => setEditedCase({...editedCase, client_name: e.target.value})}
                          className="bg-[#1a2332] border-gray-700 text-white h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-gray-500">Phone</label>
                         <div className="relative">
                          <Phone className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
                          <Input 
                            value={editedCase.phone_number || ''} 
                            onChange={e => setEditedCase({...editedCase, phone_number: e.target.value})}
                            className="bg-[#1a2332] border-gray-700 text-white h-8 pl-7"
                          />
                        </div>
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs text-gray-500">Email</label>
                        <div className="relative">
                          <Mail className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
                          <Input 
                            value={editedCase.client_email || ''} 
                            onChange={e => setEditedCase({...editedCase, client_email: e.target.value})}
                            className="bg-[#1a2332] border-gray-700 text-white h-8 pl-7"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Case Details */}
                  <div className="space-y-4">
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-400">Issue Type</label>
                            <Select 
                                value={editedCase.issue_type} 
                                onValueChange={(val) => setEditedCase({...editedCase, issue_type: val})}
                            >
                                <SelectTrigger className="bg-[#0f1419] border-gray-600 text-white">
                                <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                <SelectItem value="crypto_theft">Crypto Theft</SelectItem>
                                <SelectItem value="scam">Scam</SelectItem>
                                <SelectItem value="hacked_account">Hacked Account</SelectItem>
                                <SelectItem value="impersonation_scam">Impersonation</SelectItem>
                                <SelectItem value="recovery_request">Recovery Request</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                             <label className="text-sm font-medium text-gray-400">Amount Lost ($)</label>
                             <Input 
                                type="number"
                                value={editedCase.amount_lost || ''}
                                onChange={e => setEditedCase({...editedCase, amount_lost: e.target.value})}
                                className="bg-[#0f1419] border-gray-600 text-white"
                             />
                        </div>
                     </div>

                     <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400">Description</label>
                        <Textarea 
                            value={editedCase.description || ''}
                            onChange={e => setEditedCase({...editedCase, description: e.target.value})}
                            className="bg-[#0f1419] border-gray-600 text-white min-h-[120px]"
                        />
                     </div>

                     <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-400 flex items-center gap-2">
                            <FileText className="w-4 h-4" /> Internal Notes
                        </label>
                        <Textarea 
                            value={editedCase.notes || ''}
                            onChange={e => setEditedCase({...editedCase, notes: e.target.value})}
                            className="bg-[#0f1419] border-gray-600 text-white min-h-[100px] border-l-4 border-l-blue-500"
                            placeholder="Add internal notes here..."
                        />
                     </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-6 border-t border-gray-700 bg-[#0f1419] flex justify-between items-center">
              <p className="text-xs text-gray-500">
                {editedCase && `Last updated: ${new Date(editedCase.updated_date || editedCase.created_date).toLocaleString()}`}
              </p>
              <div className="flex gap-3">
                 <Button variant="outline" onClick={onClose} className="border-gray-600 text-gray-300 hover:bg-gray-800">
                    Close
                 </Button>
                 <Button onClick={handleSave} disabled={updateMutation.isPending} className="bg-green-600 hover:bg-green-700">
                    {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    Save Changes
                 </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}