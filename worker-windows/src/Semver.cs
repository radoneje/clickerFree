namespace ClickerFree.Worker;

public static class Semver
{
    public static int Compare(string a, string b)
    {
        var pa = a.Split('.');
        var pb = b.Split('.');
        for (var i = 0; i < 3; i++)
        {
            var xa = i < pa.Length && int.TryParse(pa[i], out var va) ? va : 0;
            var xb = i < pb.Length && int.TryParse(pb[i], out var vb) ? vb : 0;
            if (xa != xb) return xa < xb ? -1 : 1;
        }
        return 0;
    }
}
