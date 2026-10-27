import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from app.models.capture_record import CaptureRecord
from app.services.road_route_service import RoadRouteError, RoadRouteService, parse_coordinates


@pytest.fixture(autouse=True)
def _clear_plan_cache():
    """The plan cache is class-level; a leaked entry would silently serve a later test."""
    RoadRouteService._plan_cache.clear()
    yield
    RoadRouteService._plan_cache.clear()


def test_road_distance_can_choose_a_geographically_farther_stop():
    # Site 1 is much closer by straight line; the roads make site 2 preferable.
    records = [SimpleNamespace(id=1, coordinates="13.001, 80"),
               SimpleNamespace(id=2, coordinates="13.1, 80"),
               SimpleNamespace(id=3, coordinates=None)]
    def google(request):
        body = json.loads(request.content)
        assert body['travelMode'] == 'TWO_WHEELER'
        assert body['routingPreference'] == 'TRAFFIC_AWARE_OPTIMAL'
        assert request.headers['X-Goog-Api-Key'] == 'test-key'
        assert 'status' in request.headers['X-Goog-FieldMask']
        RoadRouteService._plan_cache.clear()
        assert len(body['origins']) == 1
        distances = [[10000, 2000]]
        return httpx.Response(200, json=[
            dict(originIndex=i, destinationIndex=j, status={}, condition='ROUTE_EXISTS',
                 distanceMeters=value, duration=f'{value / 10}s')
            for i, row in enumerate(distances) for j, value in enumerate(row)
        ])
    result = asyncio.run(RoadRouteService('test-key', httpx.MockTransport(google)).plan((13, 80), records))
    assert [stop['record_id'] for stop in result['stops']] == [2, 1]
    assert [stop['distance_from_origin_meters'] for stop in result['stops']] == [2000, 10000]
    assert result['stops'][1]['distance_from_origin_meters'] == 10000
    assert result['stops'][1]['duration_from_origin_seconds'] == 1000
    assert all(stop['leg_duration_seconds'] is None for stop in result['stops'])
    assert result['ordering'] == 'nearest_from_origin'
    assert result['unrouted'][0]['record_id'] == 3


def test_single_stop_uses_requested_compute_routes_api():
    RoadRouteService._plan_cache.clear()
    def google(request):
        assert str(request.url) == RoadRouteService.ROUTES_URL
        assert json.loads(request.content) == {
            'origin': {'location': {'latLng': {'latitude': 13.0827, 'longitude': 80.2707}}},
            'destination': {'location': {'latLng': {'latitude': 12.9716, 'longitude': 77.5946}}},
            'travelMode': 'TWO_WHEELER',
            'routingPreference': 'TRAFFIC_AWARE_OPTIMAL',
            'computeAlternativeRoutes': False,
        }
        assert request.headers['X-Goog-FieldMask'] == 'routes.distanceMeters,routes.duration'
        return httpx.Response(200, json={'routes': [{'distanceMeters': 345000, 'duration': '24000s'}]})
    result = asyncio.run(RoadRouteService('test-key', httpx.MockTransport(google)).plan(
        (13.0827, 80.2707), [SimpleNamespace(id=1, coordinates='12.9716,77.5946')],
    ))
    assert result['stops'][0]['distance_from_origin_meters'] == 345000
    assert result['stops'][0]['duration_from_origin_seconds'] == 24000


def test_matrix_batches_and_unreachable_stops():
    RoadRouteService._plan_cache.clear()
    records = [SimpleNamespace(id=i, coordinates=f'13.{i + 1},80') for i in range(3)]
    calls = []
    def google(request):
        body = json.loads(request.content)
        os, ds = body['origins'], body['destinations']
        calls.append((len(os), len(ds)))
        result = []
        for i, origin in enumerate(os):
            for j, dest in enumerate(ds):
                coord = dest['waypoint']['location']['latLng']['latitude']
                item = {'condition': 'ROUTE_NOT_FOUND' if coord == 13.3 else 'ROUTE_EXISTS'}
                if i: item['originIndex'] = i
                if j: item['destinationIndex'] = j
                if coord != 13.3: item.update(distanceMeters=100, duration='10s')
                result.append(item)
        return httpx.Response(200, json=result)
    service = RoadRouteService('test-key', httpx.MockTransport(google))
    service.BATCH_SIZE = 2
    result = asyncio.run(service.plan((13, 80), records))
    assert calls == [(1, 2), (1, 1)]
    assert [s['record_id'] for s in result['stops']] == [0, 1]
    assert result['unrouted'][0]['record_id'] == 2


@pytest.mark.parametrize('response', [
    httpx.Response(403, json={'error': {'message': 'secret provider message'}}),
    httpx.Response(200, json=[]),
    httpx.Response(200, json=[{'status': {'code': 7}, 'originIndex': 0, 'destinationIndex': 0}]),
])
def test_google_failure_never_falls_back_to_straight_line(response):
    RoadRouteService._plan_cache.clear()
    service = RoadRouteService('test-key', httpx.MockTransport(lambda request: response))
    records = [SimpleNamespace(id=1, coordinates='13,80'), SimpleNamespace(id=2, coordinates='14,80')]
    with pytest.raises(RoadRouteError) as error:
        asyncio.run(service.plan((12, 80), records))
    assert 'secret' not in str(error.value)


def test_missing_key_and_invalid_coordinates():
    RoadRouteService._plan_cache.clear()
    assert parse_coordinates('13.1° N, 80.2° E') == (13.1, 80.2)
    assert parse_coordinates('13.1 S; 80.2 W') == (-13.1, -80.2)
    for value in ['NaN,80', '0,0', '91,80', '13,181', '13.0xyz,80']:
        assert parse_coordinates(value) is None
    service = RoadRouteService('')
    with pytest.raises(RoadRouteError, match='not configured'):
        asyncio.run(service.plan((13, 80), [SimpleNamespace(id=1, coordinates='14,80')]))


def test_duplicate_coordinates_are_priced_once_but_expand_to_per_record_stops():
    """Three records sharing two locations only need two comparisons."""
    records = [SimpleNamespace(id=1, coordinates='13.1, 80'),
               SimpleNamespace(id=2, coordinates='13.1, 80'),
               SimpleNamespace(id=3, coordinates='13.2, 80')]
    calls = []
    def google(request):
        body = json.loads(request.content)
        calls.append((len(body['origins']), len(body['destinations'])))
        assert body['travelMode'] == 'DRIVE'
        distances = [[1000, 5000]]
        return httpx.Response(200, json=[
            dict(originIndex=i, destinationIndex=j, status={}, condition='ROUTE_EXISTS',
                 distanceMeters=value, duration=f'{value / 10}s')
            for i, row in enumerate(distances) for j, value in enumerate(row)
        ])
    service = RoadRouteService('test-key', httpx.MockTransport(google))
    service.travel_mode = 'DRIVE'
    result = asyncio.run(service.plan((13.0, 80), records))
    assert calls == [(1, 2)]
    # Co-located records share distance from the operator, not from each other.
    assert [stop['record_id'] for stop in result['stops']] == [1, 2, 3]
    assert result['stops'][0]['distance_from_origin_meters'] == result['stops'][1]['distance_from_origin_meters'] == 1000
    assert result['stops'][2]['distance_from_origin_meters'] == 5000


def test_repeated_identical_sort_reuses_cached_plan_without_new_calls():
    """The second sort of the same pending set must not re-bill Google."""
    records = [SimpleNamespace(id=1, coordinates='13.1, 80'),
               SimpleNamespace(id=2, coordinates='13.2, 80')]
    calls = []
    def google(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json=[
            dict(originIndex=i, destinationIndex=j, status={}, condition='ROUTE_EXISTS',
                 distanceMeters=1000, duration='100s')
            for i in range(1) for j in range(2)
        ])
    service = RoadRouteService('test-key', httpx.MockTransport(google))
    first = asyncio.run(service.plan((13.0, 80), records))
    second = asyncio.run(service.plan((13.0, 80), records))
    assert len(calls) == 1  # only the first sort reached Google
    assert first['stops'] == second['stops']


def test_cached_plan_expires_after_ttl(monkeypatch):
    records = [SimpleNamespace(id=1, coordinates='13.1, 80')]
    count = {'n': 0}
    clock = {'now': 1000.0}
    monkeypatch.setattr('app.services.road_route_service.time.time', lambda: clock['now'])
    def google(request):
        count['n'] += 1
        return httpx.Response(200, json={'routes': [{'distanceMeters': 5000, 'duration': '600s'}]})
    service = RoadRouteService('test-key', httpx.MockTransport(google))
    service.cache_ttl_seconds = 0
    asyncio.run(service.plan((13.0, 80), records))
    clock['now'] += service.cache_ttl_seconds + 1
    asyncio.run(service.plan((13.0, 80), records))
    assert count['n'] == 2  # TTL expired, second sort re-billed


def test_57_stops_survive_individual_google_errors_and_can_retry():
    records = [SimpleNamespace(id=i, coordinates=f'{11 + i / 1000},77') for i in range(57)]
    calls = []
    recovering = False

    def google(request):
        body = json.loads(request.content)
        origins, destinations = body['origins'], body['destinations']
        calls.append((len(origins), len(destinations)))
        elements = []
        for i, origin in enumerate(origins):
            for j, destination in enumerate(destinations):
                lat = destination['waypoint']['location']['latLng']['latitude']
                item = {'originIndex': i, 'destinationIndex': j}
                if lat == 11.056 and not recovering:
                    # Google can omit condition/duration on a failed element.
                    item['status'] = {'code': 13, 'message': 'private provider diagnostic'}
                else:
                    item.update(status={}, condition='ROUTE_EXISTS', distanceMeters=100, duration='10s')
                elements.append(item)
        return httpx.Response(200, json=elements)

    service = RoadRouteService('test-key', httpx.MockTransport(google))
    first = asyncio.run(service.plan((10.9, 77), records))
    assert len(first['stops']) == 56
    assert first['unrouted'] == [{'record_id': 56, 'reason': 'Google could not calculate this route. Click Route to retry.'}]
    assert calls == [(1, 57)]
    assert all(o * d <= 100 for o, d in calls)
    assert not service._plan_cache
    recovering = True
    second = asyncio.run(service.plan((10.9, 77), records))
    assert len(second['stops']) == 57
    assert second['unrouted'] == []
    assert calls == [(1, 57), (1, 57)]


def test_unreachable_duplicate_records_keep_reasons_on_cached_plan():
    records = [SimpleNamespace(id=1, coordinates='13.1,80'),
               SimpleNamespace(id=2, coordinates='13.2,80'),
               SimpleNamespace(id=3, coordinates='13.2,80')]
    calls = []

    def google(request):
        calls.append(request)
        return httpx.Response(200, json=[
            dict(originIndex=i, destinationIndex=j, status={},
                 condition='ROUTE_EXISTS' if j == 0 else 'ROUTE_NOT_FOUND',
                 distanceMeters=100, duration='10s')
            for i in range(1) for j in range(2)
        ])

    service = RoadRouteService('test-key', httpx.MockTransport(google))
    first = asyncio.run(service.plan((13, 80), records))
    second = asyncio.run(service.plan((13, 80), records))
    assert first == second
    assert len(calls) == 1
    assert [stop['record_id'] for stop in first['unrouted']] == [2, 3]


def test_all_element_errors_return_retry_error_without_caching():
    def google(request):
        return httpx.Response(200, json=[
            dict(originIndex=i, destinationIndex=j, status={'code': 13})
            for i in range(1) for j in range(2)
        ])
    service = RoadRouteService('test-key', httpx.MockTransport(google))
    records = [SimpleNamespace(id=1, coordinates='13.1,80'), SimpleNamespace(id=2, coordinates='13.2,80')]
    with pytest.raises(RoadRouteError, match='Please retry'):
        asyncio.run(service.plan((13, 80), records))
    assert not service._plan_cache


@pytest.mark.parametrize('code', [7, 8, 16])
def test_access_and_quota_errors_are_not_hidden_by_partial_results(code):
    def google(request):
        elements = [dict(originIndex=i, destinationIndex=j, status={},
                         condition='ROUTE_EXISTS', distanceMeters=100, duration='10s')
                    for i in range(1) for j in range(2)]
        elements[-1] = dict(originIndex=0, destinationIndex=1, status={'code': code})
        return httpx.Response(200, json=elements)
    service = RoadRouteService('test-key', httpx.MockTransport(google))
    records = [SimpleNamespace(id=1, coordinates='13.1,80'), SimpleNamespace(id=2, coordinates='13.2,80')]
    with pytest.raises(RoadRouteError, match='access, billing and quota'):
        asyncio.run(service.plan((13, 80), records))
    assert not service._plan_cache


def test_cache_does_not_mix_motorcycle_and_car_routes():
    calls = []
    def google(request):
        mode = json.loads(request.content)['travelMode']
        calls.append(mode)
        return httpx.Response(200, json={'routes': [{'distanceMeters': 100 if mode == 'TWO_WHEELER' else 500, 'duration': '60s'}]})
    service = RoadRouteService('test-key', httpx.MockTransport(google))
    records = [SimpleNamespace(id=1, coordinates='13.1,80')]
    first = asyncio.run(service.plan((13, 80), records))
    service.travel_mode = 'DRIVE'
    second = asyncio.run(service.plan((13, 80), records))
    assert calls == ['TWO_WHEELER', 'DRIVE']
    assert first['stops'][0]['distance_from_origin_meters'] == 100
    assert second['stops'][0]['distance_from_origin_meters'] == 500


def test_endpoint_checks_auth_ownership_status_and_limits(client, user_token, test_user, test_admin, db_session, monkeypatch):
    own = CaptureRecord(user_id=test_user.id, name='Own', coordinates='13,80')
    other = CaptureRecord(user_id=test_admin.id, name='Other', coordinates='14,80')
    completed = CaptureRecord(user_id=test_user.id, name='Done', status='COMPLETED', coordinates='15,80')
    db_session.add_all([own, other, completed])
    db_session.commit()
    calls = []
    async def plan(self, origin, records):
        calls.append([r.id for r in records])
        return {'travel_mode': 'TWO_WHEELER', 'stops': [], 'unrouted': []}
    monkeypatch.setattr(RoadRouteService, 'plan', plan)
    url = '/api/location/route'
    body = {'origin': {'latitude': 13.0827, 'longitude': 80.2707}, 'record_ids': [own.id]}
    headers = {'Authorization': f'Bearer {user_token}'}
    assert client.post(url, json=body).status_code == 401
    for bad_id in [other.id, completed.id, 99999]:
        assert client.post(url, json={**body, 'record_ids': [bad_id]}, headers=headers).status_code == 404
    assert client.post(url, json={**body, 'record_ids': [own.id] * 1001}, headers=headers).status_code == 422
    assert client.post(url, json={**body, 'origin': {'latitude': 91, 'longitude': 80}}, headers=headers).status_code == 422
    assert not calls
    assert client.post(url, json=body, headers=headers).status_code == 200
    assert calls == [[own.id]]


@pytest.mark.parametrize('count, batches', [(100, [100]), (300, [100, 100, 100]), (301, [100, 100, 100, 1])])
def test_nearest_first_compares_each_destination_once_and_sorts_across_batches(count, batches):
    records = [SimpleNamespace(id=i, coordinates=f'{11 + i / 1000},77') for i in range(count)]
    calls = []
    def google(request):
        body = json.loads(request.content)
        assert body['origins'] == [{'waypoint': {'location': {'latLng': {'latitude': 10, 'longitude': 77}}}}]
        calls.append(len(body['destinations']))
        elements = []
        for j, dest in enumerate(body['destinations']):
            record_id = round((dest['waypoint']['location']['latLng']['latitude'] - 11) * 1000)
            # The last page contains the closest ROAD locations.
            elements.append(dict(destinationIndex=j, condition='ROUTE_EXISTS', status={},
                                 distanceMeters=(count - record_id) * 100, duration=f'{count - record_id}s'))
        return httpx.Response(200, json=list(reversed(elements)))
    service = RoadRouteService('test-key', httpx.MockTransport(google))
    result = asyncio.run(service.plan((10, 77), records))
    assert calls == batches
    assert sum(calls) == count
    assert [s['record_id'] for s in result['stops']] == list(reversed(range(count)))
    assert result['stops'][0]['distance_from_origin_meters'] == 100
    assert result['stops'][0]['duration_from_origin_seconds'] == 1
    assert all(s['leg_distance_meters'] is None for s in result['stops'])
    assert result['unrouted'] == []


def test_endpoint_accepts_300_owned_pending_records(client, user_token, test_user, db_session, monkeypatch):
    records = [CaptureRecord(user_id=test_user.id, name=f'Site {i}', coordinates='13,80') for i in range(300)]
    db_session.add_all(records)
    db_session.commit()
    ids = [record.id for record in records]
    async def plan(self, origin, pending):
        assert [r.id for r in pending] == ids
        return {'ordering': 'nearest_from_origin', 'travel_mode': 'TWO_WHEELER', 'stops': [], 'unrouted': []}
    monkeypatch.setattr(RoadRouteService, 'plan', plan)
    response = client.post('/api/location/route', json={
        'origin': {'latitude': 13, 'longitude': 80}, 'record_ids': ids,
    }, headers={'Authorization': f'Bearer {user_token}'})
    assert response.status_code == 200


def test_ors_route_and_100m_caching(monkeypatch):
    from unittest.mock import AsyncMock
    RoadRouteService._plan_cache.clear()

    mock_ors = AsyncMock(return_value=(
        {0: {"distance_meters": 1500.0, "duration_seconds": 180.0},
         1: {"distance_meters": 500.0, "duration_seconds": 60.0}},
        "Self-Hosted OpenRouteService"
    ))
    monkeypatch.setattr('app.services.road_route_service.plan_nearest_from_origin_ors', mock_ors)

    records = [
        SimpleNamespace(id=10, coordinates="11.01, 77.01"),
        SimpleNamespace(id=20, coordinates="11.02, 77.02"),
    ]

    service = RoadRouteService('test-key')
    # 1. First call: calculates via ORS
    res1 = asyncio.run(service.plan((11.000, 77.000), records, provider="ors"))
    assert mock_ors.call_count == 1
    assert [s['record_id'] for s in res1['stops']] == [20, 10]
    assert res1['stops'][0]['distance_from_origin_meters'] == 500.0
    assert res1['provider'] == 'ors'
    assert 'Self-Hosted' in res1['provider_label']

    # 2. Operator moves 40 meters (within 100m threshold): reuses cached route with 0 API calls
    res2 = asyncio.run(service.plan((11.0003, 77.000), records, provider="ors"))
    assert mock_ors.call_count == 1  # 0 new API calls!
    assert [s['record_id'] for s in res2['stops']] == [20, 10]
    assert 'cached, 0 API calls' in res2['provider_label']

    # 3. Operator moves 500 meters (beyond 100m threshold): refreshes route with new API call
    res3 = asyncio.run(service.plan((11.005, 77.000), records, provider="ors"))
    assert mock_ors.call_count == 2

