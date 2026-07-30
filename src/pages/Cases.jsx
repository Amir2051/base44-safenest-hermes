import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  Search, Filter, Plus, Clock, CheckCircle2, AlertTriangle, 
  Phone, User, MoreHorizontal, ArrowUpRight, Shield, Sparkles
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import NewCaseModal from "../components/cases/NewCaseModal";
import CaseDetailDialog from "@/components/investigation/CaseDetailDialog";
import CaseAssignmentModal from "../components/cases/CaseAssignmentModal";

import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function Cases() {
  const [user, setUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedUrgency, setSelectedUrgency] = useState("all");
  const [selectedIssue, setSelectedIssue] = useState("all");
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all_cases");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    base44.auth.me().then(userData => {
      if (mounted) {
        if (userData.role !== 'admin' && !userData.is_admin) {
          navigate(createPageUrl("Dashboard"));
        }
        setUser(userData);
      }
    }).catch(() => {
      if (mounted) navigate(createPageUrl("Dashboard"));
    });
    return () => { mounted = false; };
  }, [navigate]);

  const { data: fetchedCases = [], isLoading: loadingCases } = useQuery({
    queryKey: ['my-cases-admin'],
    queryFn: async () => {
      let data = [];
      if (user?.role === 'admin' || user?.is_admin) {
        data = await base44.entities.MyCase.list('-created_date', 1000);
      } else {
        data = await base44.entities.MyCase.filter({ created_by: user.email }, '-created_date', 1000);
      }
      if (!Array.isArray(data) || data.length === 0) {
        const mod = await import('@/hooks/useLocalData');
        return mod.localList('cases');
      }
      return data;
    },
    enabled: !!user
  });

  const cases = useMemo(() => {
    return fetchedCases.map(c => ({
      ...c,
      id: c.id,
      case_title: c.case_number ? `${c.case_number} - ${c.issue_type}` : c.client_name,
      status: c.status || 'Pending',
      urgency: c.urgency || 'Medium',
      issue_type: c.issue_type || 'Other',
      created_date: c.created_date,
      amount_lost: c.amount_lost || 0,
      client_name: c.client_name || c.created_by_name || 'Unknown',
      client_email: c.client_email || c.created_by_email,
      display_email: [c.client_email, c.created_by_email, c.created_by, c.client_name, c.created_by_name].find(e => e && typeof e === 'string' && !e.trim().toLowerCase().startsWith('service+') && !e.toLowerCase().includes('no-reply.base44.com') && !e.toLowerCase().includes('base44.com')) || 'Unknown User',
      type: 'client',
      _entityName: 'MyCase'
    })).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  }, [fetchedCases]);

  const isLoading = loadingCases;

  const openCaseDetail = (caseItem) => {
    // Find the full object if we only have ID, but here we pass the object
    if (typeof caseItem === 'string') {
       const found = cases.find(c => c.id === caseItem);
       if (found) setSelectedCaseId(found);
    } else {
       setSelectedCaseId(caseItem);
    }
    setIsDetailOpen(true);
  };

  // Filter logic
  const filterCases = (caseList) => {
    return caseList.filter(c => {
      const matchesSearch = 
        (c.client_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.client_email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.issue_type || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.case_number || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = selectedStatus === "all" || c.status === selectedStatus;
      const matchesUrgency = selectedUrgency === "all" || c.urgency === selectedUrgency;
      const matchesIssue = selectedIssue === "all" || c.issue_type === selectedIssue;

      return matchesSearch && matchesStatus && matchesUrgency && matchesIssue;
    });
  };

  const myCases = cases.filter(c => c.assigned_to === user?.email);
  
  const displayedCases = filterCases(activeTab === "my_cases" ? myCases : cases);

  const getUrgencyColor = (urgency) => {
    switch (urgency) {
      case 'High': return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'Medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      case 'Low': return 'bg-green-500/20 text-green-400 border-green-500/50';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
    }
  };

  const getStatusColor = (status) => {
    const s = (status || '').toLowerCase();
    if (['resolved', 'recovered', 'approved', 'completed'].includes(s)) {
      return 'bg-green-500/20 text-green-400 border-green-500/50';
    }
    if (['closed', 'deemed', 'rejected', 'denied'].includes(s)) {
      return 'bg-red-500/20 text-red-400 border-red-500/50';
    }
    // Pending, New, In Progress, etc.
    return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
  };

  const getStatusIcon = (status) => {
    const s = (status || '').toLowerCase();
    if (['resolved', 'recovered', 'approved', 'completed'].includes(s)) return <CheckCircle2 className="w-4 h-4" />;
    if (['closed', 'deemed', 'rejected'].includes(s)) return <AlertTriangle className="w-4 h-4" />;
    return <Clock className="w-4 h-4" />;
  };

  if (!user) return <div className="p-8 text-center text-white">Loading...</div>;

  return (
    <div className="min-h-screen bg-[#0f1419] p-6 lg:p-8 text-white">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Shield className="w-8 h-8 text-blue-500" />
            Client Case Management
          </h1>
          <p className="text-gray-400 mt-1">Manage cybersecurity support requests and crypto recovery cases</p>
        </div>
        <div className="flex gap-3">
          <NewCaseModal onCaseCreated={() => queryClient.invalidateQueries({ queryKey: ['my-cases-admin'] })} />
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card className="bg-[#1a2332] border-gray-700">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Pending Cases</p>
              <p className="text-2xl font-bold text-white">{cases.filter(c => c.status === 'Pending').length}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
              <Clock className="w-5 h-5 text-yellow-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[#1a2332] border-gray-700">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">High Urgency</p>
              <p className="text-2xl font-bold text-red-400">{cases.filter(c => c.urgency === 'High').length}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[#1a2332] border-gray-700">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Assigned to Me</p>
              <p className="text-2xl font-bold text-blue-400">{myCases.length}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <User className="w-5 h-5 text-blue-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[#1a2332] border-gray-700">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Resolved (All Time)</p>
              <p className="text-2xl font-bold text-green-400">{cases.filter(c => c.status === 'Resolved').length}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-[#1a2332] border border-gray-700 p-1">
          <TabsTrigger value="all_cases" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white px-6">
            All Cases
          </TabsTrigger>
          <TabsTrigger value="my_cases" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white px-6">
            My Assignments
          </TabsTrigger>
        </TabsList>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center bg-[#1a2332] p-4 rounded-lg border border-gray-700">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input 
              placeholder="Search client, email, or issue..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-[#0f1419] border-gray-600 text-white"
            />
          </div>
          
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="w-[160px] bg-[#0f1419] border-gray-600 text-white">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="In Progress">In Progress</SelectItem>
              <SelectItem value="Called">Called</SelectItem>
              <SelectItem value="Resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>

          <Select value={selectedUrgency} onValueChange={setSelectedUrgency}>
            <SelectTrigger className="w-[160px] bg-[#0f1419] border-gray-600 text-white">
              <SelectValue placeholder="Urgency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Urgencies</SelectItem>
              <SelectItem value="High">High</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="Low">Low</SelectItem>
            </SelectContent>
          </Select>

           <Select value={selectedIssue} onValueChange={setSelectedIssue}>
            <SelectTrigger className="w-[180px] bg-[#0f1419] border-gray-600 text-white">
              <SelectValue placeholder="Issue Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Issues</SelectItem>
              <SelectItem value="crypto_theft">Crypto Theft</SelectItem>
              <SelectItem value="scam">Scam</SelectItem>
              <SelectItem value="hacked_account">Hacked Account</SelectItem>
              <SelectItem value="impersonation_scam">Impersonation</SelectItem>
              <SelectItem value="recovery_request">Recovery</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TabsContent value={activeTab} className="mt-0">
          <div className="grid gap-4">
            {displayedCases.map(caseItem => (
              <Card 
                key={caseItem.id} 
                className="bg-[#1a2332] border-gray-700 hover:border-blue-500/50 transition-all cursor-pointer group"
                onClick={() => openCaseDetail(caseItem)}
                >
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-mono text-cyan-400 flex items-center gap-2">
                             <User className="w-3 h-3" />
                             {caseItem.display_email}
                          </p>
                          <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">
                            {caseItem.case_title || caseItem.client_name || 'Untitled Case'}
                          </h3>
                        </div>
                        {caseItem.priority_score !== undefined && (
                          <Badge className={`
                            ${caseItem.priority_score >= 80 ? 'bg-red-500/20 text-red-400 border-red-500/50' : 
                              caseItem.priority_score >= 50 ? 'bg-orange-500/20 text-orange-400 border-orange-500/50' : 
                              'bg-blue-500/20 text-blue-400 border-blue-500/50'}
                            flex items-center gap-1
                          `}>
                            <Sparkles className="w-3 h-3" />
                            AI Score: {caseItem.priority_score}
                          </Badge>
                        )}
                        <Badge className={getUrgencyColor(caseItem.urgency)} variant="outline">
                          {caseItem.urgency} Priority
                        </Badge>
                        <Badge variant="outline" className="border-gray-600 text-gray-400 capitalize">
                          {caseItem.issue_type.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      
                      <p className="text-gray-300 line-clamp-2 text-sm">
                        {caseItem.description}
                      </p>

                      <div className="flex flex-wrap gap-4 text-sm text-gray-500 pt-2">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Created: {new Date(caseItem.created_date).toLocaleDateString()}
                        </span>
                        {caseItem.amount_lost > 0 && (
                          <span className="text-red-400 font-medium">
                            Lost: ${caseItem.amount_lost.toLocaleString()}
                          </span>
                        )}
                        {caseItem.assigned_to ? (
                           <span className="flex items-center gap-1 text-blue-300">
                            <User className="w-3 h-3" />
                            {caseItem.assigned_to}
                          </span>
                        ) : (
                          <span className="text-yellow-500">Unassigned</span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end justify-between gap-4 min-w-[140px]">
                      <Badge className={`${getStatusColor(caseItem.status)} border px-3 py-1.5 flex items-center gap-2`}>
                        {getStatusIcon(caseItem.status)}
                        <span className="text-sm font-bold uppercase">{caseItem.status}</span>
                      </Badge>
                      
                      <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                        <CaseAssignmentModal caseId={caseItem.id} />
                        <Button size="sm" variant="ghost" onClick={() => openCaseDetail(caseItem)}>
                          Manage Case
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            
            {displayedCases.length === 0 && (
              <div className="text-center py-12 bg-[#1a2332] rounded-lg border border-gray-700">
                <Shield className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white">No cases found</h3>
                <p className="text-gray-400 mt-2">Adjust your filters or create a new case.</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {isDetailOpen && selectedCaseId && (
        <CaseDetailDialog 
          caseData={selectedCaseId} 
          onClose={() => {
            setIsDetailOpen(false);
            setSelectedCaseId(null);
          }} 
          onUpdate={() => {
             queryClient.invalidateQueries({ queryKey: ['my-cases-admin'] });
          }}
        />
      )}
    </div>
  );
}