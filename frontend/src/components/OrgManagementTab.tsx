// frontend/src/components/OrgManagementTab.tsx
import React, { useState, useCallback } from 'react';
import { OrgModal } from './modals/OrgModal';
import { useToast } from './Toast';
import type { Org } from '../types';

interface OrgManagementTabProps {
  orgs: Org[];
  loading: boolean;
  onAddOrg: (org: Omit<Org, 'id'>) => Promise<void>;
  onEditOrg: (orgId: string, org: Omit<Org, 'id'>) => Promise<void>;
  onDeleteOrg: (orgId: string) => Promise<void>;
  onRefresh: () => void;
}

export const OrgManagementTab: React.FC<OrgManagementTabProps> = ({
  orgs,
  loading,
  onAddOrg,
  onEditOrg,
  onDeleteOrg,
  onRefresh
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Org | null>(null);
  const [deletingOrgId, setDeletingOrgId] = useState<string | null>(null);
  const { showToast } = useToast();

  const handleAdd = useCallback(() => {
    setEditingOrg(null);
    setShowModal(true);
  }, []);

  const handleEdit = useCallback((org: Org) => {
    setEditingOrg(org);
    setShowModal(true);
  }, []);

  const handleDelete = useCallback(async (orgId: string) => {
    const org = orgs.find(o => o.id === orgId);
    if (!org) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${org.name}"?\n\nThis action cannot be undone.`
    );

    if (confirmed) {
      setDeletingOrgId(orgId);
      try {
        await onDeleteOrg(orgId);
        showToast(`Organization "${org.name}" deleted successfully`, 'success');
      } catch (error) {
        showToast(`Failed to delete organization: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      } finally {
        setDeletingOrgId(null);
      }
    }
  }, [orgs, onDeleteOrg, showToast]);

  const handleSave = useCallback(async (orgData: Omit<Org, 'id'>) => {
    try {
      if (editingOrg) {
        await onEditOrg(editingOrg.id, orgData);
        showToast(`Organization "${orgData.name}" updated successfully`, 'success');
      } else {
        await onAddOrg(orgData);
        showToast(`Organization "${orgData.name}" added successfully`, 'success');
      }
      setShowModal(false);
      setEditingOrg(null);
    } catch (error) {
      showToast(`Failed to save organization: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [editingOrg, onAddOrg, onEditOrg, showToast]);

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Manage Organizations</h2>
        <div className="flex space-x-2">
          <button
            onClick={onRefresh}
            className="px-4 py-2 text-sm text-blue-600 hover:text-blue-800"
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
            disabled={loading}
          >
            + Add Organization
          </button>
        </div>
      </div>

      {orgs.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-400 text-6xl mb-4">🏢</div>
          <p className="text-gray-600 mb-4">No organizations configured yet</p>
          <button
            onClick={handleAdd}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Add Your First Organization
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Organization
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  URL
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Username
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {orgs.map((org) => (
                <tr key={org.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{org.name}</div>
                      <div className="text-xs text-gray-500">ID: {org.id}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <a 
                      href={org.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {org.url.replace('https://', '').replace('.lightning.force.com/', '')}
                    </a>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {org.username}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEdit(org)}
                      className="text-blue-600 hover:text-blue-900 mr-4"
                      disabled={deletingOrgId === org.id}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(org.id)}
                      className="text-red-600 hover:text-red-900"
                      disabled={deletingOrgId === org.id}
                    >
                      {deletingOrgId === org.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <h3 className="font-semibold text-blue-900 mb-2">Security Notes</h3>
        <ul className="list-disc list-inside text-sm text-blue-800 space-y-1">
          <li>Organization credentials are stored securely on the backend server</li>
          <li>Passwords are never displayed after saving</li>
          <li>Make sure to use dedicated integration user accounts when possible</li>
          <li>Regularly rotate passwords for security</li>
        </ul>
      </div>

      {showModal && (
        <OrgModal
          org={editingOrg}
          onSave={handleSave}
          onClose={() => {
            setShowModal(false);
            setEditingOrg(null);
          }}
        />
      )}
    </div>
  );
};