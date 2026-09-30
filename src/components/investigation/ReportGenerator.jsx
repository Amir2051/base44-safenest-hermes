import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, FileText, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function ReportGenerator({ selectedCase }) {
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState(null);
  const [reportType, setReportType] = useState('full_investigation');
  const [sections, setSections] = useState({
    case_overview: true,
    victim_info: true,
    suspect_info: true,
    transaction_evidence: true,
    evidence_files: true,
    observations: true
  });

  const reportTypes = [
    { id: 'full_investigation', name: 'Full Investigation Report', description: 'Comprehensive report with all details.' },
    { id: 'summary_report', name: 'Summary Report', description: 'Executive summary and key findings only.' },
    { id: 'evidence_report', name: 'Evidence Report', description: 'Focuses on collected evidence and transaction logs.' },
    { id: 'suspect_profile', name: 'Suspect Profile', description: 'Detailed profile of the suspect and wallet analysis.' }
  ];

  const handleTypeChange = (type) => {
    setReportType(type);
    if (type === 'full_investigation') {
      setSections({
        case_overview: true, victim_info: true, suspect_info: true, 
        transaction_evidence: true, evidence_files: true, observations: true
      });
    } else if (type === 'summary_report') {
      setSections({
        case_overview: true, victim_info: false, suspect_info: false, 
        transaction_evidence: false, evidence_files: false, observations: true
      });
    } else if (type === 'evidence_report') {
      setSections({
        case_overview: true, victim_info: false, suspect_info: false, 
        transaction_evidence: true, evidence_files: true, observations: false
      });
    } else if (type === 'suspect_profile') {
      setSections({
        case_overview: true, victim_info: false, suspect_info: true, 
        transaction_evidence: true, evidence_files: false, observations: true
      });
    }
  };

  const generateReport = async () => {
    if (!selectedCase) {
      toast.error("Please select a case first");
      return;
    }

    setGenerating(true);
    try {
      const response = await base44.functions.invoke('cryptoInvestigation', {
        action: 'generate-investigation-report',
        data: { caseId: selectedCase.id }
      });

      setReport(response.data.data.report);
      toast.success("Investigation report generated");
      trackEvent('report_generated', { event_category: 'reports' });
    } catch (error) {
      toast.error("Failed to generate report: " + error.message);
    }
    setGenerating(false);
  };

  const downloadPDF = async () => {
    setGenerating(true);
    try {
        const response = await base44.functions.invoke('generateCasePdf', { 
            caseId: selectedCase.id,
            template: reportType,
            sections: sections
        });

        if (response.headers && response.headers['content-type'] === 'application/json') {
            if (response.data.error) throw new Error(response.data.error);
        }

        const blob = new Blob([response.data], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Case_${selectedCase.case_number || 'Report'}_${reportType}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        toast.success("Report downloaded");
    } catch (error) {
        let errorMsg = "Generation failed";
        if (error.response?.data instanceof ArrayBuffer) {
            try {
                const dec = new TextDecoder();
                const text = dec.decode(error.response.data);
                const json = JSON.parse(text);
                errorMsg = json.error || errorMsg;
            } catch(err){}
        } else if (error.message) {
            errorMsg = error.message;
        }
        toast.error(errorMsg);
    }
    setGenerating(false);
  };

  // Removed downloadPDF duplicate implementation

  return (
    <Card className="bg-gradient-to-br from-[#1a2332] to-[#0f1419] border-red-500/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-red-400" />
            Law Enforcement Report Generator
          </CardTitle>
          {selectedCase && (
            <Button
              onClick={generateReport}
              disabled={generating}
              className="bg-gradient-to-r from-red-500 to-orange-600"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Preview...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Generate Preview
                </>
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {selectedCase && !report && (
            <div className="mb-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="text-gray-300 text-sm font-medium mb-2 block">Report Template</label>
                        <div className="space-y-2">
                            {reportTypes.map((type) => (
                                <div 
                                    key={type.id}
                                    onClick={() => handleTypeChange(type.id)}
                                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                                        reportType === type.id 
                                        ? 'bg-red-500/20 border-red-500 text-white' 
                                        : 'bg-[#0f1419] border-gray-800 text-gray-400 hover:border-gray-600'
                                    }`}
                                >
                                    <p className="font-semibold text-sm">{type.name}</p>
                                    <p className="text-xs opacity-70">{type.description}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="text-gray-300 text-sm font-medium mb-2 block">Customize Content</label>
                        <div className="space-y-2 bg-[#0f1419] p-4 rounded-lg border border-gray-800">
                            {Object.entries(sections).map(([key, enabled]) => (
                                <div key={key} className="flex items-center gap-2">
                                    <input 
                                        type="checkbox" 
                                        id={key}
                                        checked={enabled}
                                        onChange={(e) => setSections({...sections, [key]: e.target.checked})}
                                        className="rounded border-gray-600 bg-gray-800 text-red-500 focus:ring-red-500"
                                    />
                                    <label htmlFor={key} className="text-sm text-gray-300 capitalize cursor-pointer select-none">
                                        {key.replace(/_/g, ' ')}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        )}

        {!selectedCase ? (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">Select a case to generate investigation report</p>
          </div>
        ) : !report ? (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 mb-4">Click "Generate Report" to create a comprehensive investigation document</p>
            <p className="text-sm text-gray-500">
              Report will include: Timeline, Wallet Addresses, TXIDs, Flow Map, Exchange Details, Evidence, and More
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Report Header */}
            <div className="p-6 bg-green-500/10 border border-green-500/30 rounded-lg">
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle className="w-8 h-8 text-green-400" />
                <div>
                  <h3 className="text-white font-bold text-lg">Report Generated Successfully</h3>
                  <p className="text-gray-400 text-sm">ID: {report.reportId}</p>
                </div>
              </div>
              <Button onClick={downloadPDF} className="bg-green-500 hover:bg-green-600 w-full">
                <Download className="w-4 h-4 mr-2" />
                Download Report (PDF)
              </Button>
            </div>

            {/* Report Preview */}
            <div className="space-y-4">
              <div className="p-4 bg-[#0f1419] rounded-lg">
                <h4 className="text-white font-semibold mb-3">Case Details</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-400">Case Title</p>
                    <p className="text-white">{report.caseDetails.title}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Case ID</p>
                    <p className="text-white font-mono text-xs">{report.caseDetails.caseId}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Reported Date</p>
                    <p className="text-white">{new Date(report.caseDetails.reportedDate).toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Status</p>
                    <Badge>{report.caseDetails.status}</Badge>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[#0f1419] rounded-lg">
                <h4 className="text-white font-semibold mb-3">Victim Information</h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-gray-400">Wallet Address</p>
                    <p className="text-white font-mono text-xs">
                        {selectedCase?.redacted_fields?.includes('victim_wallet') ? '[REDACTED]' : (report.victimInformation.wallet || 'N/A')}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400">Reported By</p>
                    <p className="text-white">
                        {selectedCase?.redacted_fields?.includes('client_email') ? '[REDACTED]' : report.victimInformation.reportedBy}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400">Amount Lost</p>
                    <p className="text-red-400 font-bold">${report.victimInformation.amountLost?.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[#0f1419] rounded-lg">
                <h4 className="text-white font-semibold mb-3">Scammer Information</h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-gray-400">Wallet Address</p>
                    <p className="text-red-400 font-mono text-xs">
                        {selectedCase?.redacted_fields?.includes('scammer_wallet') ? '[REDACTED]' : report.scammerInformation.wallet}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400">Blockchain</p>
                    <p className="text-white">{report.scammerInformation.blockchain}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Fraud Type</p>
                    <Badge variant="outline">{report.scammerInformation.fraudType}</Badge>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[#0f1419] rounded-lg">
                <h4 className="text-white font-semibold mb-3">Blockchain Analysis</h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-gray-400">Traced Wallets</p>
                    <p className="text-white">{report.blockchainAnalysis.tracedWallets.length} wallets identified</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Exchanges Notified</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {report.blockchainAnalysis.exchangesNotified.map((ex, idx) => (
                        <Badge key={idx} className="bg-green-500/20 text-green-400">{ex}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[#0f1419] rounded-lg">
                <h4 className="text-white font-semibold mb-3">Evidence Collected</h4>
                <p className="text-white text-sm">{report.evidence.length} pieces of evidence attached</p>
              </div>

              <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <h4 className="text-yellow-400 font-semibold mb-2">Recommendation</h4>
                <p className="text-white text-sm">{report.recommendation}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}