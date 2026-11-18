import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { 
    Plus, Upload, Shield, AlertTriangle, FileText, 
    DollarSign, Hash, Wallet, Search, Check, X,
    Edit2, Trash2, ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export default function EvidenceIntake({ caseId, onUpdate }) {
    const [activeTab, setActiveTab] = useState("review");
    const [isUploading, setIsUploading] = useState(false);
    const queryClient = useQueryClient();

    // Fetch Evidence Items
    const { data: evidenceItems = [], isLoading } = useQuery({
        queryKey: ['evidence-items', caseId],
        queryFn: () => base44.entities.CaseEvidenceItem.filter({ case_id: caseId }, '-created_date', 100),
    });

    const fileInputRef = React.useRef(null);

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsUploading(true);
        const toastId = toast.loading("Uploading and extracting evidence...");

        try {
            // 1. Upload File
            const uploadRes = await base44.integrations.Core.UploadFile({ file });
            
            // 2. Create File Entity
            const fileEntity = await base44.entities.CaseEvidenceFile.create({
                case_id: caseId,
                file_url: uploadRes.file_url,
                filename: file.name,
                file_size: file.size,
                mime_type: file.type,
                uploaded_at: new Date().toISOString(),
                parse_status: 'PENDING'
            });

            // 3. Process
            await base44.functions.invoke('evidenceProcessing', {
                action: 'process_upload',
                data: {
                    caseId: caseId,
                    evidenceFileId: fileEntity.id,
                    fileUrl: uploadRes.file_url,
                    fileType: file.type,
                    fileName: file.name
                }
            });

            toast.success("Extraction complete. Review new items.", { id: toastId });
            queryClient.invalidateQueries(['evidence-items', caseId]);
            if (onUpdate) onUpdate();
            setActiveTab("review");

        } catch (error) {
            console.error(error);
            toast.error("Failed to process evidence", { id: toastId });
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = ""; // Reset input
        }
    };

    return (
        <div className="space-y-6">
            {/* Header / Actions */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#0f1419] p-4 rounded-lg border border-cyan-500/20">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Shield className="w-5 h-5 text-cyan-400" />
                        Evidence Intake System
                    </h2>
                    <p className="text-gray-400 text-sm">Centralized evidence collection, extraction, and validation.</p>
                </div>
                <div className="flex gap-2">
                    <input 
                        type="file" 
                        className="hidden" 
                        onChange={handleUpload} 
                        disabled={isUploading}
                        ref={fileInputRef}
                    />
                    <Button 
                        disabled={isUploading} 
                        className="bg-cyan-600 hover:bg-cyan-700"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        {isUploading ? (
                            <><span className="animate-spin mr-2">⏳</span> Extracting...</>
                        ) : (
                            <><Upload className="w-4 h-4 mr-2" /> Auto-Extract from File</>
                        )}
                    </Button>
                    <Button variant="outline" onClick={() => setActiveTab("manual")} className="border-cyan-500/30 text-cyan-400">
                        <Plus className="w-4 h-4 mr-2" /> Manual Entry
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="bg-[#0f1419] border border-cyan-500/30">
                    <TabsTrigger value="review">
                        Evidence Review 
                        {evidenceItems.some(i => i.status === 'pending_review') && (
                            <Badge className="ml-2 bg-yellow-500/20 text-yellow-400 text-[10px] border-0">
                                {evidenceItems.filter(i => i.status === 'pending_review').length} New
                            </Badge>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                </TabsList>

                <TabsContent value="review" className="mt-4">
                    <EvidenceReviewList items={evidenceItems} caseId={caseId} />
                </TabsContent>

                <TabsContent value="manual" className="mt-4">
                    <ManualEntryForm caseId={caseId} onSuccess={() => {
                        setActiveTab("review");
                        queryClient.invalidateQueries(['evidence-items', caseId]);
                    }} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function EvidenceReviewList({ items, caseId }) {
    const queryClient = useQueryClient();

    const updateStatus = useMutation({
        mutationFn: ({ id, status, data }) => base44.entities.CaseEvidenceItem.update(id, { status, ...data }),
        onSuccess: (_result, variables) => {
            toast.success(variables.status === 'confirmed' ? "Finding verified" : variables.status === 'rejected' ? "Finding rejected" : "Evidence updated");
            queryClient.invalidateQueries(['evidence-items', caseId]);
        }
    });

    const categories = {
        blockchain_transaction: { icon: Hash, label: "Transaction", color: "text-blue-400" },
        wallet_address: { icon: Wallet, label: "Wallet", color: "text-purple-400" },
        contract_interaction: { icon: FileText, label: "Contract", color: "text-orange-400" },
        financial_impact: { icon: DollarSign, label: "Financial", color: "text-red-400" },
        scam_indicator: { icon: AlertTriangle, label: "Scam Flag", color: "text-yellow-400" },
        supporting_document: { icon: FileText, label: "Document", color: "text-gray-400" }
    };

    if (items.length === 0) {
        return (
            <div className="text-center py-12 bg-[#0f1419] rounded-lg border border-cyan-500/10">
                <Search className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400">No structured evidence recorded yet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {items.map(item => {
                const config = categories[item.category] || categories.supporting_document;
                const Icon = config.icon;
                const isPending = item.status === 'pending_review';

                return (
                    <Card key={item.id} className={`bg-[#0f1419] border ${isPending ? 'border-yellow-500/30' : 'border-cyan-500/20'}`}>
                        <div className="p-4 flex flex-col md:flex-row gap-4">
                            <div className="flex-1 space-y-2">
                                <div className="flex items-center gap-3">
                                    <Badge variant="outline" className={`${config.color} border-current flex items-center gap-1`}>
                                        <Icon className="w-3 h-3" />
                                        {config.label}
                                    </Badge>
                                    <Badge variant="outline" className="text-gray-400">
                                        {item.source.toUpperCase()}
                                    </Badge>
                                    {isPending && (
                                        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/50 animate-pulse">
                                            NEEDS REVIEW
                                        </Badge>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-2">
                                    {/* Dynamic Data Display */}
                                    {Object.entries(item.data).map(([key, val]) => (
                                        <div key={key}>
                                            <span className="text-gray-500 block text-xs uppercase">{key.replace('_', ' ')}</span>
                                            <span className="text-white font-mono break-all">{typeof val === 'object' ? JSON.stringify(val) : val}</span>
                                        </div>
                                    ))}
                                </div>

                                {item.analyst_note && (
                                    <div className="mt-2 text-xs text-cyan-400/80 italic border-l-2 border-cyan-500/30 pl-2">
                                        "{item.analyst_note}"
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-row md:flex-col justify-center gap-2 border-t md:border-t-0 md:border-l border-gray-800 pt-4 md:pt-0 md:pl-4">
                                {isPending ? (
                                    <>
                                        <Button 
                                            size="sm" 
                                            className="bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-600/50"
                                            onClick={() => updateStatus.mutate({ id: item.id, status: 'confirmed' })}
                                        >
                                            <Check className="w-4 h-4 mr-1" /> Verify Finding
                                        </Button>
                                        <Button 
                                            size="sm" 
                                            variant="ghost"
                                            className="text-red-400 hover:bg-red-900/20"
                                            onClick={() => updateStatus.mutate({ id: item.id, status: 'rejected' })}
                                        >
                                            <X className="w-4 h-4 mr-1" /> Reject
                                        </Button>
                                    </>
                                ) : (
                                    <Button 
                                        size="sm" 
                                        variant="outline" 
                                        className="border-gray-700 text-gray-400"
                                        onClick={() => updateStatus.mutate({ id: item.id, status: 'pending_review' })}
                                    >
                                        <Edit2 className="w-4 h-4 mr-1" /> Edit
                                    </Button>
                                )}
                            </div>
                        </div>
                    </Card>
                );
            })}
        </div>
    );
}

function ManualEntryForm({ caseId, onSuccess }) {
    const [category, setCategory] = useState("blockchain_transaction");
    const [formData, setFormData] = useState({});
    const [note, setNote] = useState("");

    const createMutation = useMutation({
        mutationFn: (newItem) => base44.entities.CaseEvidenceItem.create(newItem),
        onSuccess: () => {
            toast.success("Evidence added successfully");
            setFormData({});
            setNote("");
            onSuccess();
        }
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        createMutation.mutate({
            case_id: caseId,
            category,
            data: formData,
            source: 'manual',
            analyst_note: note,
            status: 'confirmed', // Manual entry implies confirmation
            confidence: 'high'
        });
    };

    const handleDataChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    return (
        <Card className="bg-[#0f1419] border-cyan-500/20">
            <CardContent className="p-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label className="text-white">Evidence Category</Label>
                        <Select value={category} onValueChange={(v) => { setCategory(v); setFormData({}); }}>
                            <SelectTrigger className="bg-[#1a2332] border-cyan-500/30 text-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="blockchain_transaction">Blockchain Transaction</SelectItem>
                                <SelectItem value="wallet_address">Wallet Address</SelectItem>
                                <SelectItem value="contract_interaction">Contract Interaction</SelectItem>
                                <SelectItem value="financial_impact">Financial Impact</SelectItem>
                                <SelectItem value="scam_indicator">Scam Indicator</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Dynamic Fields based on Category */}
                    <div className="grid md:grid-cols-2 gap-4 p-4 bg-[#1a2332] rounded-lg">
                        {category === 'blockchain_transaction' && (
                            <>
                                <div className="md:col-span-2">
                                    <Label className="text-gray-400 text-xs">Transaction Hash</Label>
                                    <Input required className="bg-black/20 border-cyan-500/20 text-white font-mono" onChange={e => handleDataChange('transaction_hash', e.target.value)} />
                                </div>
                                <div>
                                    <Label className="text-gray-400 text-xs">From Address</Label>
                                    <Input className="bg-black/20 border-cyan-500/20 text-white font-mono" onChange={e => handleDataChange('from_address', e.target.value)} />
                                </div>
                                <div>
                                    <Label className="text-gray-400 text-xs">To Address</Label>
                                    <Input className="bg-black/20 border-cyan-500/20 text-white font-mono" onChange={e => handleDataChange('to_address', e.target.value)} />
                                </div>
                                <div>
                                    <Label className="text-gray-400 text-xs">Amount</Label>
                                    <Input type="number" step="0.000001" className="bg-black/20 border-cyan-500/20 text-white" onChange={e => handleDataChange('amount', parseFloat(e.target.value))} />
                                </div>
                                <div>
                                    <Label className="text-gray-400 text-xs">Token / Asset</Label>
                                    <Input className="bg-black/20 border-cyan-500/20 text-white" placeholder="ETH, USDT..." onChange={e => handleDataChange('token', e.target.value)} />
                                </div>
                            </>
                        )}

                        {category === 'wallet_address' && (
                            <>
                                <div className="md:col-span-2">
                                    <Label className="text-gray-400 text-xs">Wallet Address</Label>
                                    <Input required className="bg-black/20 border-cyan-500/20 text-white font-mono" onChange={e => handleDataChange('wallet_address', e.target.value)} />
                                </div>
                                <div>
                                    <Label className="text-gray-400 text-xs">Role</Label>
                                    <Select onValueChange={v => handleDataChange('role', v)}>
                                        <SelectTrigger className="bg-black/20 border-cyan-500/20 text-white"><SelectValue placeholder="Select role" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="victim">Victim</SelectItem>
                                            <SelectItem value="suspected_scammer">Suspected Scammer</SelectItem>
                                            <SelectItem value="intermediary">Intermediary / Mule</SelectItem>
                                            <SelectItem value="exchange">Exchange Deposit</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </>
                        )}

                        {category === 'scam_indicator' && (
                            <>
                                <div>
                                    <Label className="text-gray-400 text-xs">Indicator Type</Label>
                                    <Select onValueChange={v => handleDataChange('indicator', v)}>
                                        <SelectTrigger className="bg-black/20 border-cyan-500/20 text-white"><SelectValue placeholder="Select type" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="dust_transaction">Dust Transaction</SelectItem>
                                            <SelectItem value="wallet_linkage">Wallet Linkage</SelectItem>
                                            <SelectItem value="reused_wallet">Reused Wallet</SelectItem>
                                            <SelectItem value="funnel_behavior">Funnel Behavior</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-gray-400 text-xs">Detected (Yes/No)</Label>
                                    <Select onValueChange={v => handleDataChange('detected', v === 'yes')}>
                                        <SelectTrigger className="bg-black/20 border-cyan-500/20 text-white"><SelectValue placeholder="Select" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="yes">Yes</SelectItem>
                                            <SelectItem value="no">No</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </>
                        )}
                        
                        {/* Fallback for other categories to generic key-value inputs could go here, staying minimal for now */}
                    </div>

                    <div>
                        <Label className="text-white">Analyst Note</Label>
                        <Textarea 
                            placeholder="Explain the significance of this evidence..." 
                            className="bg-[#1a2332] border-cyan-500/30 text-white mt-1"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        />
                    </div>

                    <div className="flex justify-end">
                        <Button type="submit" className="bg-green-600 hover:bg-green-700">
                            <Check className="w-4 h-4 mr-2" /> Save Evidence
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}