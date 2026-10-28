import importlib.util
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('hedge_jobs',Path(__file__).parents[1]/'scripts'/'hedge_jobs.py')
jobs=importlib.util.module_from_spec(spec)
spec.loader.exec_module(jobs)


class HedgeJobTests(unittest.TestCase):
    def environment(self):
        return {'HEDGE_RADAR_USER_ID':'owner','HEDGE_REFRESH_VERSION':'7','GITHUB_RUN_ID':'123',
                'GITHUB_REPOSITORY':'owner/repo','GITHUB_EVENT_NAME':'workflow_dispatch'}

    def test_start_binds_exact_request_and_workflow(self):
        calls=[]
        def rpc(name,payload):
            calls.append((name,payload))
            return {'started':True,'revision':7}
        self.assertTrue(jobs.start(self.environment(),rpc)['started'])
        name,payload=calls[0]
        self.assertEqual(name,'start_hedge_radar_run')
        self.assertEqual(payload['p_revision'],7)
        self.assertEqual(payload['p_run_id'],123)
        self.assertEqual(payload['p_run_url'],'https://github.com/owner/repo/actions/runs/123')

    def test_scheduled_job_reserves_a_new_revision_in_database(self):
        env=self.environment();env['HEDGE_REFRESH_VERSION']='';env['GITHUB_EVENT_NAME']='schedule'
        def rpc(name,payload):
            self.assertIsNone(payload['p_revision'])
            self.assertEqual(payload['p_source'],'scheduled')
            return {'started':False}
        self.assertFalse(jobs.start(env,rpc)['started'])

    def test_finish_uses_guarded_rpc_not_an_unconditional_state_write(self):
        def rpc(name,payload):
            self.assertEqual(name,'fail_hedge_radar_run')
            self.assertEqual(payload['p_revision'],7)
            self.assertEqual(payload['p_run_id'],123)
            return False
        self.assertFalse(jobs.finish(self.environment(),rpc)['unfinished_run_marked_failed'])

    def test_missing_revision_skips_cleanup(self):
        env=self.environment();env['HEDGE_REFRESH_VERSION']=''
        self.assertTrue(jobs.finish(env,lambda *_:self.fail('İş kimliği olmadan durum yazılmaz'))['skipped'])


if __name__=='__main__': unittest.main()
